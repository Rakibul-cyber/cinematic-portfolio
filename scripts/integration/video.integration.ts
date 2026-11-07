// Must stay first: refuses a missing, ambiguous, or production-looking target
// before anything that can connect is loaded.
import { videoSuiteTarget as target } from "./video-suite-gate";
import "../lib/require-non-production-database";

import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Pool, type PoolClient } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "@/generated/prisma/client";
import { projectSchema } from "@/lib/validation/cms";
import { ProjectConflictError, ProjectVideoAssignmentError, runProjectSave, type ProjectSaveResult } from "@/server/cms/project-save";
import { VideoProviderError } from "@/server/video/errors";
import type { CreateDirectUploadInput, MuxAsset, MuxClient, MuxDirectUpload } from "@/server/video/mux-client";
import { PrismaVideoRepository, uploaderLockKey } from "@/server/video/prisma-repository";
import type { BeginDeletionResult, VideoRecord } from "@/server/video/repository";
import { Secret } from "@/server/video/secret";
import { createVideoService, DELETION_STALE_AFTER_MS, type VideoActor, type VideoService, type VideoTransitionEvent } from "@/server/video/service";
import { computeMuxSignature } from "@/server/video/webhook-signature";

import { assessObservedDatabase, MARKER_TABLE } from "./identity";
import { assessAdditiveMigration, assessVideoSuiteDatabase, migrationsBefore, VIDEO_MIGRATION } from "./video-target";

/**
 * Video MVP against real PostgreSQL on the disposable Neon branch (MH-09).
 *
 * Run ONLY through `npm run integration:run -- --env-file <path>
 * --allow-disposable-writes`, which verifies the branch, marks it, applies every
 * migration through the guarded runner, loads the network guard, and passes the
 * dedicated configuration. Started any other way, `video-suite-gate.ts` refuses
 * before a driver loads, and the read-only check below refuses a database that
 * is empty, unmarked, or missing the video migration.
 *
 * What only a real database can prove, and the unit tests (fake clients) cannot:
 * the advisory lock, `FOR UPDATE` queueing and READ COMMITTED re-evaluation,
 * the RESTRICT and CASCADE keys, transaction rollback, and that the migration
 * really is additive and reversible.
 *
 * Mux is a local fake: no provider request leaves this process. Every row this
 * suite creates is tagged with the run tag and removed afterwards; the branch is
 * deleted after the run anyway.
 */

const TAG = randomUUID().slice(0, 8);
const WEBHOOK_SECRET = `integration-webhook-${TAG}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const LOCK_WAIT_TIMEOUT_MS = 4_000;

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: target.env.DATABASE_URL }), log: ["error"] });
const repository = new PrismaVideoRepository(prisma);
/** Direct (unpooled) sessions for blockers, observers, and the scratch schema. */
const pool = new Pool({ connectionString: target.env.DATABASE_URL_UNPOOLED, max: 4 });

// ------------------------------------------------------------------ fake provider

class FakeMux implements MuxClient {
  readonly uploads = new Map<string, MuxDirectUpload>();
  readonly assets = new Map<string, MuxAsset>();
  readonly deletedAssets: string[] = [];
  #counter = 0;

  async createDirectUpload(input: CreateDirectUploadInput): Promise<MuxDirectUpload> {
    this.#counter += 1;
    const id = `It${TAG}Upload${String(this.#counter).padStart(6, "0")}`;
    const upload: MuxDirectUpload = { id, status: "waiting", url: `https://storage.example.invalid/upload/${id}`, assetId: null, timeoutSeconds: input.timeoutSeconds };
    this.uploads.set(id, upload);
    await new Promise((resolve) => setImmediate(resolve));
    return { ...upload };
  }

  async getDirectUpload(uploadId: string): Promise<MuxDirectUpload> {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new VideoProviderError("not_found", 404);
    return { ...upload };
  }

  async cancelDirectUpload(uploadId: string): Promise<MuxDirectUpload> {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new VideoProviderError("not_found", 404);
    if (upload.status !== "waiting") throw new VideoProviderError("invalid_request", 400);
    upload.status = "cancelled";
    return { ...upload };
  }

  async getAsset(assetId: string): Promise<MuxAsset> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new VideoProviderError("not_found", 404);
    return { ...asset, signedPlaybackIds: [...asset.signedPlaybackIds] };
  }

  async deleteAsset(assetId: string): Promise<void> {
    if (!this.assets.delete(assetId)) throw new VideoProviderError("not_found", 404);
    this.deletedAssets.push(assetId);
  }

  /** The file arrives; the upload (whatever its state) gets an asset. */
  finishUpload(uploadId: string, videoId: string, status: MuxAsset["status"]): MuxAsset {
    const upload = this.uploads.get(uploadId);
    assert.ok(upload, "known upload");
    const n = uploadId.slice(-6);
    const asset: MuxAsset = {
      id: `It${TAG}Asset${n}`, status, uploadId, passthrough: videoId, durationSeconds: 42.5, maxResolution: "2160p",
      width: 3840, height: 2160, signedPlaybackIds: [`It${TAG}Playback${n}`], errorType: null,
    };
    upload.status = "asset_created";
    upload.assetId = asset.id;
    this.assets.set(asset.id, asset);
    return asset;
  }
}

// ------------------------------------------------------------------ fixtures

let counter = 0;
const next = () => (counter += 1);
const createdUsers: string[] = [];
const createdProjects: string[] = [];
let categoryId = "";

let mux: FakeMux;
let transitions: VideoTransitionEvent[];
let service: VideoService;

function buildService(): void {
  mux = new FakeMux();
  transitions = [];
  service = createVideoService({
    repository,
    mux,
    config: { webhookSecret: new Secret(WEBHOOK_SECRET), signingKeyId: `It${TAG}SigningKey`, signingPrivateKey: privateKey },
    corsOrigin: "http://localhost:3101",
    onTransition: (event) => void transitions.push(event),
  });
}

async function createUser(role: VideoActor["role"]): Promise<VideoActor> {
  const id = `it-${TAG}-user-${next()}`;
  await prisma.user.create({ data: { id, name: `Integration ${role}`, email: `${id}@integration.invalid`, emailVerified: true, role } });
  createdUsers.push(id);
  return { id, role };
}

async function createProject() {
  const n = next();
  const project = await prisma.project.create({
    data: { title: `Integration project ${n}`, slug: `it-${TAG}-project-${n}`, summary: "Integration summary.", description: "Integration description.", categoryId },
  });
  createdProjects.push(project.id);
  return project;
}

/** A video row in the given state, with a matching fake asset when it has one. */
async function seedVideo(uploader: VideoActor, status: VideoRecord["status"] = "READY") {
  const n = String(next()).padStart(6, "0");
  const hasAsset = status !== "UPLOAD_PENDING" && status !== "CANCELLED";
  const video = await prisma.video.create({
    data: {
      title: `Integration film ${n}`, originalFilename: `film-${n}.mp4`, declaredSizeBytes: BigInt(1_500_000_000), status, uploaderId: uploader.id,
      muxUploadId: `It${TAG}SeedUpload${n}`, muxAssetId: hasAsset ? `It${TAG}SeedAsset${n}` : null,
      playbackId: status === "READY" ? `It${TAG}SeedPlayback${n}` : null, uploadExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  if (video.muxAssetId) {
    mux.assets.set(video.muxAssetId, {
      id: video.muxAssetId, status: "ready", uploadId: video.muxUploadId, passthrough: video.id, durationSeconds: 60,
      maxResolution: "2160p", width: 3840, height: 2160, signedPlaybackIds: [video.playbackId ?? "none"], errorType: null,
    });
  }
  return video;
}

/** A project save as the admin form submits it (unparsed form values). */
async function formValues(projectId: string, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  return {
    id: project.id, expectedUpdatedAt: project.updatedAt, title: project.title, slug: project.slug, summary: project.summary,
    description: project.description, clientName: "", location: "", projectDate: "", categoryId: project.categoryId, status: "DRAFT",
    featured: false, sortOrder: 0, seoTitle: "", seoDescription: "", mediaIds: [], videoIds: [], ...overrides,
  };
}

/** The same values, parsed by the real schema. */
const saveInput = async (projectId: string, overrides: Record<string, unknown> = {}) => projectSchema.parse(await formValues(projectId, overrides));

const save = async (projectId: string, overrides: Record<string, unknown> = {}) =>
  runProjectSave(prisma, await saveInput(projectId, overrides), { manageVideos: true });

const assignments = (where: { projectId?: string; videoId?: string }) =>
  prisma.projectVideo.findMany({ where, orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }] }).then((rows) => rows.map((row) => `${row.projectId}:${row.videoId}`));

const statusOf = async (id: string) => (await prisma.video.findUnique({ where: { id } }))?.status ?? "GONE";

function signed(event: unknown) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  return { rawBody: body, signatureHeader: `t=${timestamp},v1=${computeMuxSignature(WEBHOOK_SECRET, timestamp, body)}` };
}
const assetEvent = (type: string, asset: MuxAsset) => ({ id: `evt-${TAG}-${next()}`, type, data: { id: asset.id, upload_id: asset.uploadId } });
const uploadEvent = (type: string, uploadId: string) => ({ id: `evt-${TAG}-${next()}`, type, data: { id: uploadId } });

// ------------------------------------------------------------------ real sessions

/** A separate direct session that holds a lock until `release` is called. */
async function blocker(sql: string, values: unknown[]): Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql, values);
  } catch (error) {
    client.release(true);
    throw error;
  }
  const end = async (statement: string) => {
    try {
      await client.query(statement);
    } finally {
      client.release();
    }
  };
  return { commit: () => end("COMMIT"), rollback: () => end("ROLLBACK") };
}

/** Waits until at least `count` other sessions of this database wait on a lock. */
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  const client = await pool.connect();
  try {
    for (;;) {
      const { rows } = await client.query(
        "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
      );
      if ((rows[0] as { waiting: number }).waiting >= count) return;
      if (Date.now() > deadline) throw new Error(`Expected ${count} session(s) waiting on a lock; the operation did not block.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    client.release();
  }
}

/** Resolves to "pending" if the promise has not settled within `ms`. */
const settledWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => "settled" as const, () => "settled" as const), new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);

// ------------------------------------------------------------------ guard and cleanup

before(async () => {
  // One server-enforced READ ONLY transaction decides whether this suite may write.
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const who = (await client.query("SELECT current_database() AS database, current_user AS usr")).rows[0] as { database: string; usr: string };
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((row) => String((row as { table_name: string }).table_name));
    const marker = tables.includes(MARKER_TABLE)
      ? (await client.query(`SELECT project_id, branch_id, endpoint_id FROM public.${MARKER_TABLE}`)).rows as Array<{ project_id: string; branch_id: string; endpoint_id: string }>
      : null;
    const migrations = tables.includes("_prisma_migrations")
      ? (await client.query('SELECT migration_name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((row) => String((row as { migration_name: string }).migration_name))
      : [];
    await client.query("COMMIT");

    const observed = assessObservedDatabase(target, { database: who.database, user: who.usr, tables, marker });
    if (!observed.ok) throw new Error(`Refused: ${observed.reasons.join(" ")}`);
    const expectedMigrations = readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const ready = assessVideoSuiteDatabase({ state: observed.value, migrations, expectedMigrations });
    if (!ready.ok) throw new Error(`Refused: ${ready.reasons.join(" ")}`);
  } finally {
    client.release();
  }

  const category = await prisma.portfolioCategory.create({ data: { name: `Integration ${TAG}`, slug: `it-${TAG}-category` } });
  categoryId = category.id;
  buildService();
});

after(async () => {
  try {
    if (categoryId) {
      await prisma.projectVideo.deleteMany({ where: { projectId: { in: createdProjects } } });
      await prisma.projectVideo.deleteMany({ where: { video: { uploaderId: { in: createdUsers } } } });
      await prisma.video.deleteMany({ where: { uploaderId: { in: createdUsers } } });
      await prisma.project.deleteMany({ where: { id: { in: createdProjects } } });
      await prisma.portfolioCategory.deleteMany({ where: { id: categoryId } });
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
});

// ------------------------------------------------------------------ 1. migration

describe("migration 20261106120000_add_uploaded_video", () => {
  const migrationsDir = join(process.cwd(), "prisma/migrations");
  const sqlOf = (name: string) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");

  it("contains only additive statements", () => {
    const checked = assessAdditiveMigration(sqlOf(VIDEO_MIGRATION), ["video", "project_video"]);
    assert.deepEqual(checked, { ok: true, value: null });
  });

  it("applies on top of the previous schema without changing it or its data, and the rehearsed rollback restores it exactly", async () => {
    const all = readdirSync(migrationsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const previous = migrationsBefore(all);
    assert.equal(previous.ok, true, previous.ok ? "" : previous.reasons.join(" "));
    if (!previous.ok) return;

    // A scratch schema on one direct session: `public` is never touched.
    const schema = `it_video_migration_${TAG.replace(/[^a-z0-9]/g, "")}`;
    const client: PoolClient = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of previous.value) await client.query(sqlOf(name));

      // Data that existed before the migration.
      await client.query(`INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt") VALUES ('u1', 'Owner', 'u1@integration.invalid', true, 'ADMIN', now(), now())`);
      await client.query(`INSERT INTO "portfolio_category" (id, name, slug, "updatedAt") VALUES ('c1', 'Films', 'films', now())`);
      await client.query(`INSERT INTO "project" (id, title, slug, summary, description, "categoryId", "updatedAt") VALUES ('p1', 'Existing', 'existing', 's', 'd', 'c1', now())`);

      const snapshot = async () => {
        const q = async (sql: string) => JSON.stringify((await client.query(sql, [schema])).rows);
        return {
          tables: await q("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1"),
          columns: await q("SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY 1, 2"),
          constraints: await q("SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = $1::regnamespace ORDER BY 1, 2"),
          indexes: await q("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY 1, 2"),
          types: await q("SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = $1::regnamespace GROUP BY 1 ORDER BY 1"),
          data: await q(`SELECT (SELECT json_agg(u ORDER BY u.id) FROM "${schema}"."user" u) AS users, (SELECT json_agg(c ORDER BY c.id) FROM "${schema}"."portfolio_category" c) AS categories, (SELECT json_agg(p ORDER BY p.id) FROM "${schema}"."project" p) AS projects, $1::text AS s`),
        };
      };
      const onlyOld = (json: string, oldTables: readonly string[], key: string) =>
        JSON.stringify((JSON.parse(json) as Array<Record<string, string>>).filter((row) => oldTables.includes(String(row[key]).replace(/^.*\./, "").replace(/"/g, ""))));

      const beforeMigration = await snapshot();
      const oldTables = (JSON.parse(beforeMigration.tables) as Array<{ table_name: string }>).map((row) => row.table_name);

      await client.query("BEGIN");
      await client.query(sqlOf(VIDEO_MIGRATION));
      await client.query("COMMIT");
      const afterMigration = await snapshot();

      // Existing tables, keys, indexes, types, and rows are untouched.
      assert.equal(onlyOld(afterMigration.columns, oldTables, "table_name"), onlyOld(beforeMigration.columns, oldTables, "table_name"));
      assert.equal(onlyOld(afterMigration.constraints, oldTables, "tbl"), onlyOld(beforeMigration.constraints, oldTables, "tbl"));
      assert.equal(onlyOld(afterMigration.indexes, oldTables, "tablename"), onlyOld(beforeMigration.indexes, oldTables, "tablename"));
      assert.equal(afterMigration.data, beforeMigration.data);
      const beforeTypes = JSON.parse(beforeMigration.types) as Array<{ typname: string }>;
      const afterTypes = JSON.parse(afterMigration.types) as Array<{ typname: string; labels: string[] }>;
      assert.deepEqual(afterTypes.filter((t) => t.typname !== "VideoStatus"), beforeTypes);

      // The new objects are exactly as designed.
      assert.deepEqual(afterTypes.find((t) => t.typname === "VideoStatus")?.labels, ["UPLOAD_PENDING", "PROCESSING", "READY", "FAILED", "CANCELLED", "DELETING", "DELETE_FAILED"]);
      const keys = JSON.parse(afterMigration.constraints) as Array<{ conname: string; def: string }>;
      const def = (name: string) => keys.find((k) => k.conname === name)?.def ?? "";
      assert.match(def("project_video_videoId_fkey"), /ON DELETE RESTRICT/);
      assert.match(def("project_video_projectId_fkey"), /ON DELETE CASCADE/);
      assert.match(def("video_uploaderId_fkey"), /ON DELETE RESTRICT/);
      const indexes = JSON.parse(afterMigration.indexes) as Array<{ indexname: string; indexdef: string }>;
      for (const name of ["video_muxUploadId_key", "video_muxAssetId_key", "video_playbackId_key"]) {
        assert.match(indexes.find((index) => index.indexname === name)?.indexdef ?? "", /CREATE UNIQUE INDEX/, name);
      }

      // The new tables work with pre-existing rows.
      await client.query(`INSERT INTO "video" (id, title, "originalFilename", "declaredSizeBytes", "uploaderId", "muxUploadId", "uploadExpiresAt", "updatedAt") VALUES ('v1', 'Film', 'film.mp4', 1, 'u1', 'up1', now(), now())`);
      await client.query(`INSERT INTO "project_video" ("projectId", "videoId") VALUES ('p1', 'v1')`);
      await assert.rejects(client.query(`DELETE FROM "video" WHERE id = 'v1'`), /foreign key/i);

      // Rollback rehearsal: the statements from VIDEO_INTEGRATION_CHECKLIST.md.
      await client.query("BEGIN");
      await client.query('DROP TABLE "project_video"; DROP TABLE "video"; DROP TYPE "VideoStatus";');
      await client.query("COMMIT");
      assert.deepEqual(await snapshot(), beforeMigration, "the rollback must restore the previous schema and data exactly");

      // And forward again.
      await client.query("BEGIN");
      await client.query(sqlOf(VIDEO_MIGRATION));
      await client.query("COMMIT");
      const reapplied = await snapshot();
      assert.deepEqual({ ...reapplied, data: "" }, { ...afterMigration, data: "" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      // The session carries a search_path; never return it to the pool.
      client.release(true);
    }
  });
});

// ------------------------------------------------------------------ 2–3. uploads and the active limit

describe("upload sessions and the two-active-upload limit (advisory lock)", () => {
  const start = (actor: VideoActor) => service.createUploadSession(actor, { title: "Showreel", filename: "showreel.mp4", fileSizeBytes: 1_500_000_000 });

  it("accepts two concurrent uploads by one user as two separate rows", async () => {
    const editor = await createUser("EDITOR");
    const results = await Promise.all([start(editor), start(editor)]);
    assert.ok(results.every((result) => result.ok), JSON.stringify(results.map((r) => !r.ok && r.error)));
    const rows = await prisma.video.findMany({ where: { uploaderId: editor.id } });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.muxUploadId)).size, 2);
    assert.ok(rows.every((row) => row.status === "UPLOAD_PENDING"));
  });

  it("never exceeds two active uploads under six concurrent requests, and leaves no orphan provider upload", async () => {
    buildService(); // a fresh fake provider, so every upload in it belongs to this test
    const editor = await createUser("EDITOR");
    const results = await Promise.all(Array.from({ length: 6 }, () => start(editor)));
    assert.equal(results.filter((result) => result.ok).length, 2);
    assert.ok(results.filter((result) => !result.ok).every((result) => !result.ok && result.error === "too_many_uploads"));
    assert.equal(await repository.countActiveUploads(editor.id, new Date()), 2);
    // Every provider upload still waiting belongs to a stored row; the rest were cancelled.
    const stored = new Set((await prisma.video.findMany({ where: { uploaderId: editor.id } })).map((row) => row.muxUploadId));
    const orphans = [...mux.uploads.values()].filter((upload) => upload.status === "waiting" && !stored.has(upload.id));
    assert.deepEqual(orphans, []);
  });

  it("holds the limit at the repository even without the service pre-check (ten parallel inserts)", async () => {
    const editor = await createUser("EDITOR");
    const now = new Date();
    const record = (): VideoRecord => {
      const n = String(next()).padStart(6, "0");
      return {
        id: randomUUID(), title: "Direct", originalFilename: "direct.mp4", declaredSizeBytes: 1, status: "UPLOAD_PENDING", uploaderId: editor.id,
        muxUploadId: `It${TAG}Direct${n}`, muxAssetId: null, playbackId: null, durationSeconds: null, width: null, height: null, maxResolution: null,
        failureCode: null, uploadExpiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now,
      };
    };
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => repository.insertWithinActiveLimit(record(), 2, now)));
    assert.equal(outcomes.filter((outcome) => outcome === "inserted").length, 2);
    assert.equal(await prisma.video.count({ where: { uploaderId: editor.id } }), 2);
  });

  it("serialises on a per-uploader lock: a held lock blocks that uploader only", async () => {
    const [blocked, free] = [await createUser("EDITOR"), await createUser("EDITOR")];
    const lock = await blocker("SELECT pg_advisory_xact_lock($1::bigint)", [uploaderLockKey(blocked.id).toString()]);
    let pending: Promise<unknown> | undefined;
    try {
      pending = start(blocked);
      await waitForLockWaiters(1);
      const other = await start(free);
      assert.equal(other.ok, true, "another uploader is not blocked");
      assert.equal(await settledWithin(pending, 300), "pending", "the locked uploader waits");
    } finally {
      await lock.rollback();
    }
    const result = (await pending) as { ok: boolean };
    assert.equal(result.ok, true);
  });

  it("frees a slot when an upload is cancelled or its URL has expired", async () => {
    const editor = await createUser("EDITOR");
    const [first, second] = await Promise.all([start(editor), start(editor)]);
    assert.ok(first.ok && second.ok);
    assert.equal((await start(editor)).ok, false);

    const cancelled = await service.cancelUploadSession(editor, first.videoId);
    assert.equal(cancelled.ok, true);
    assert.equal(await statusOf(first.videoId), "CANCELLED");
    const third = await start(editor);
    assert.equal(third.ok, true);

    await prisma.video.update({ where: { id: second.videoId }, data: { uploadExpiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await start(editor)).ok, true, "an expired upload no longer counts");
  });
});

// ------------------------------------------------------------------ 4. conditional transitions

describe("conditional status transitions (compare-and-set)", () => {
  it("changes nothing when the expected status does not match", async () => {
    const video = await seedVideo(await createUser("EDITOR"), "PROCESSING");
    assert.equal(await repository.updateIfStatus(video.id, "UPLOAD_PENDING", { status: "CANCELLED" }, new Date()), null);
    const stored = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    assert.equal(stored.status, "PROCESSING");
    assert.equal(stored.updatedAt.getTime(), video.updatedAt.getTime());
  });

  it("lets exactly one of eight concurrent identical transitions win", async () => {
    const video = await seedVideo(await createUser("EDITOR"), "UPLOAD_PENDING");
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.updateIfStatus(video.id, "UPLOAD_PENDING", { status: "PROCESSING" }, new Date())));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await statusOf(video.id), "PROCESSING");
  });

  it("lets exactly one of two competing transitions win, and the row shows the winner", async () => {
    for (let round = 0; round < 5; round += 1) {
      const video = await seedVideo(await createUser("EDITOR"), "UPLOAD_PENDING");
      const [cancel, process] = await Promise.all([
        repository.updateIfStatus(video.id, "UPLOAD_PENDING", { status: "CANCELLED" }, new Date()),
        repository.updateIfStatus(video.id, "UPLOAD_PENDING", { status: "PROCESSING" }, new Date()),
      ]);
      assert.equal(Number(Boolean(cancel)) + Number(Boolean(process)), 1);
      assert.equal(await statusOf(video.id), cancel ? "CANCELLED" : "PROCESSING");
    }
  });

  it("re-evaluates the condition after waiting on a row lock (READ COMMITTED)", async () => {
    const editor = await createUser("EDITOR");

    // Another session cancels and commits: the waiting stale transition changes nothing.
    const lost = await seedVideo(editor, "UPLOAD_PENDING");
    const cancelling = await blocker(`UPDATE "video" SET "status" = 'CANCELLED' WHERE "id" = $1`, [lost.id]);
    const stale = repository.updateIfStatus(lost.id, "UPLOAD_PENDING", { status: "PROCESSING" }, new Date());
    try {
      await waitForLockWaiters(1);
    } catch (error) {
      await cancelling.rollback();
      throw error;
    }
    await cancelling.commit();
    assert.equal(await stale, null, "the stale transition must not overwrite the committed one");
    assert.equal(await statusOf(lost.id), "CANCELLED");

    // The other session rolls back: the waiting transition applies.
    const kept = await seedVideo(editor, "UPLOAD_PENDING");
    const abandoned = await blocker(`UPDATE "video" SET "status" = 'CANCELLED' WHERE "id" = $1`, [kept.id]);
    const applied = repository.updateIfStatus(kept.id, "UPLOAD_PENDING", { status: "PROCESSING" }, new Date());
    try {
      await waitForLockWaiters(1);
    } finally {
      await abandoned.rollback();
    }
    assert.ok(await applied);
    assert.equal(await statusOf(kept.id), "PROCESSING");
  });
});

// ------------------------------------------------------------------ 5. webhooks

describe("duplicate and late webhooks", () => {
  async function readyUpload() {
    const editor = await createUser("EDITOR");
    const result = await service.createUploadSession(editor, { title: "Webhook film", filename: "film.mp4", fileSizeBytes: 1_000_000 });
    assert.ok(result.ok);
    const row = await prisma.video.findUniqueOrThrow({ where: { id: result.videoId } });
    return { editor, videoId: result.videoId, uploadId: row.muxUploadId };
  }

  it("applies four concurrent duplicates of video.asset.ready as one READY row and one transition", async () => {
    const { videoId, uploadId } = await readyUpload();
    const asset = mux.finishUpload(uploadId, videoId, "ready");
    const event = assetEvent("video.asset.ready", asset);
    const before = transitions.length;
    const answers = await Promise.all(Array.from({ length: 4 }, () => service.handleMuxWebhook(signed(event))));
    assert.ok(answers.every((answer) => answer.status === 200), JSON.stringify(answers));
    const row = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    assert.equal(row.status, "READY");
    assert.equal(row.muxAssetId, asset.id);
    assert.equal(row.playbackId, asset.signedPlaybackIds[0]);
    assert.equal(transitions.slice(before).filter((t) => t.videoId === videoId && t.to === "READY").length, 1);
  });

  it("leaves a READY row unchanged on redelivery and on late or out-of-order events", async () => {
    const { videoId, uploadId } = await readyUpload();
    const asset = mux.finishUpload(uploadId, videoId, "ready");
    assert.equal((await service.handleMuxWebhook(signed(assetEvent("video.asset.ready", asset)))).status, 200);
    const ready = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });

    for (const event of [assetEvent("video.asset.ready", asset), uploadEvent("video.upload.asset_created", uploadId), assetEvent("video.asset.created", asset)]) {
      assert.deepEqual(await service.handleMuxWebhook(signed(event)), { status: 200, outcome: "unchanged" });
    }
    // A late "errored" cannot demote a READY video.
    mux.assets.get(asset.id)!.status = "errored";
    assert.deepEqual(await service.handleMuxWebhook(signed(assetEvent("video.asset.errored", asset))), { status: 200, outcome: "unchanged" });
    const after = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    assert.equal(after.status, "READY");
    assert.equal(after.updatedAt.getTime(), ready.updatedAt.getTime());
  });

  it("deletes the provider asset that arrives after a cancellation, and keeps the row CANCELLED", async () => {
    const { editor, videoId, uploadId } = await readyUpload();
    assert.equal((await service.cancelUploadSession(editor, videoId)).ok, true);
    const asset = mux.finishUpload(uploadId, videoId, "ready");
    assert.deepEqual(await service.handleMuxWebhook(signed(assetEvent("video.asset.ready", asset))), { status: 200, outcome: "unchanged" });
    assert.equal(await statusOf(videoId), "CANCELLED");
    assert.ok(mux.deletedAssets.includes(asset.id));
  });

  it("does not touch a video that is being deleted", async () => {
    const { videoId, uploadId } = await readyUpload();
    const asset = mux.finishUpload(uploadId, videoId, "ready");
    await prisma.video.update({ where: { id: videoId }, data: { status: "DELETING" } });
    assert.deepEqual(await service.handleMuxWebhook(signed(assetEvent("video.asset.ready", asset))), { status: 200, outcome: "unchanged" });
    assert.equal(await statusOf(videoId), "DELETING");
  });

  it("ignores an event for an unknown upload", async () => {
    assert.deepEqual(await service.handleMuxWebhook(signed(uploadEvent("video.upload.asset_created", `It${TAG}Unknown`))), { status: 200, outcome: "ignored" });
  });
});

// ------------------------------------------------------------------ 6. assignment versus deletion

describe("concurrent project assignment versus deletion (FOR UPDATE on the video row)", () => {
  const stale = () => new Date(Date.now() - DELETION_STALE_AFTER_MS);

  it("deletion first: the save waits, then is refused and rolled back", async () => {
    const admin = await createUser("ADMIN");
    const [project, video] = [await createProject(), await seedVideo(admin)];
    const versionBefore = project.updatedAt.getTime();
    const lock = await blocker(`SELECT 1 FROM "video" WHERE "id" = $1 FOR UPDATE`, [video.id]);
    let deletion: Promise<BeginDeletionResult> | undefined;
    let saving: Promise<ProjectSaveResult> | undefined;
    try {
      deletion = repository.beginDeletion(video.id, new Date(), stale());
      await waitForLockWaiters(1);
      saving = save(project.id, { title: "Renamed during the race", videoIds: [video.id] });
      saving.catch(() => undefined);
      await waitForLockWaiters(2);
    } finally {
      await lock.commit();
    }
    assert.equal((await deletion)?.outcome, "started");
    await assert.rejects(saving!, ProjectVideoAssignmentError);
    assert.equal(await statusOf(video.id), "DELETING");
    assert.deepEqual(await assignments({ videoId: video.id }), []);
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(stored.title, project.title, "the whole save rolled back");
    assert.equal(stored.updatedAt.getTime(), versionBefore);
  });

  it("assignment first: the deletion waits, then is refused as assigned", async () => {
    const admin = await createUser("ADMIN");
    const [project, video] = [await createProject(), await seedVideo(admin)];
    const lock = await blocker(`SELECT 1 FROM "video" WHERE "id" = $1 FOR UPDATE`, [video.id]);
    let deletion: Promise<BeginDeletionResult> | undefined;
    let saving: Promise<ProjectSaveResult> | undefined;
    try {
      saving = save(project.id, { videoIds: [video.id] });
      saving.catch(() => undefined);
      await waitForLockWaiters(1);
      deletion = repository.beginDeletion(video.id, new Date(), stale());
      await waitForLockWaiters(2);
    } finally {
      await lock.commit();
    }
    assert.deepEqual((await saving)?.videoChange?.added, [video.id]);
    assert.deepEqual(await deletion, { outcome: "refused", reason: "delete_assigned" });
    assert.equal(await statusOf(video.id), "READY");
    assert.deepEqual(await assignments({ videoId: video.id }), [`${project.id}:${video.id}`]);
  });

  it("keeps the invariant under twenty unsynchronised races of save and full deletion", async () => {
    const admin = await createUser("ADMIN");
    const outcomes = { assigned: 0, deleted: 0 };
    for (let round = 0; round < 20; round += 1) {
      const [project, video] = [await createProject(), await seedVideo(admin)];
      const [saved, deleted] = await Promise.allSettled([save(project.id, { videoIds: [video.id] }), service.deleteVideo(admin, video.id)]);
      const status = await statusOf(video.id);
      const assigned = await assignments({ videoId: video.id });
      if (saved.status === "fulfilled") {
        outcomes.assigned += 1;
        assert.deepEqual(deleted.status === "fulfilled" && deleted.value, { ok: false, error: "delete_assigned", retryable: false });
        assert.equal(status, "READY");
        assert.equal(assigned.length, 1);
      } else {
        outcomes.deleted += 1;
        assert.ok(saved.reason instanceof ProjectVideoAssignmentError, String(saved.reason));
        assert.deepEqual(deleted.status === "fulfilled" && deleted.value, { ok: true });
        assert.equal(status, "GONE");
        assert.equal(assigned.length, 0);
      }
    }
    console.log(`    race outcomes: ${JSON.stringify(outcomes)}`);
  });

  it("two saves sharing videos in opposite order neither deadlock nor lose an assignment", async () => {
    const admin = await createUser("ADMIN");
    for (let round = 0; round < 5; round += 1) {
      const [p, q, v1, v2] = [await createProject(), await createProject(), await seedVideo(admin), await seedVideo(admin)];
      await Promise.all([save(p.id, { videoIds: [v1.id, v2.id] }), save(q.id, { videoIds: [v2.id, v1.id] })]);
      assert.equal((await assignments({ projectId: p.id })).length, 2);
      assert.equal((await assignments({ projectId: q.id })).length, 2);
    }
  });
});

// ------------------------------------------------------------------ 7. shared video deletion

describe("deleting a video assigned to several projects", () => {
  it("is refused while any project uses it, is protected by the RESTRICT key, and succeeds once unassigned", async () => {
    const admin = await createUser("ADMIN");
    const [p1, p2, video] = [await createProject(), await createProject(), await seedVideo(admin)];
    await save(p1.id, { videoIds: [video.id] });
    await save(p2.id, { videoIds: [video.id] });

    assert.deepEqual(await service.deleteVideo(admin, video.id), { ok: false, error: "delete_assigned", retryable: false });
    assert.equal(await statusOf(video.id), "READY");
    assert.equal(mux.deletedAssets.includes(video.muxAssetId!), false, "no provider call while assigned");

    // Even a caller that skips the service check cannot remove an assigned row.
    await prisma.video.update({ where: { id: video.id }, data: { status: "DELETING" } });
    await assert.rejects(repository.deleteIfDeleting(video.id));
    assert.equal(await statusOf(video.id), "DELETING");
    assert.equal((await assignments({ videoId: video.id })).length, 2);
    await prisma.video.update({ where: { id: video.id }, data: { status: "READY" } });

    await save(p1.id, { videoIds: [] });
    assert.deepEqual(await service.deleteVideo(admin, video.id), { ok: false, error: "delete_assigned", retryable: false });

    await save(p2.id, { videoIds: [] });
    assert.deepEqual(await service.deleteVideo(admin, video.id), { ok: true });
    assert.equal(await statusOf(video.id), "GONE");
    assert.ok(mux.deletedAssets.includes(video.muxAssetId!));
  });

  it("removes only that project's assignments when a project is deleted (CASCADE), never the video", async () => {
    const admin = await createUser("ADMIN");
    const [p1, p2, video] = [await createProject(), await createProject(), await seedVideo(admin)];
    await save(p1.id, { videoIds: [video.id] });
    await save(p2.id, { videoIds: [video.id] });
    await prisma.project.delete({ where: { id: p1.id } });
    assert.equal(await statusOf(video.id), "READY");
    assert.deepEqual(await assignments({ videoId: video.id }), [`${p2.id}:${video.id}`]);
  });
});

// ------------------------------------------------------------------ 8. rollback

describe("project save rollback", () => {
  async function assignedProject() {
    const admin = await createUser("ADMIN");
    const [project, kept] = [await createProject(), await seedVideo(admin)];
    await save(project.id, { videoIds: [kept.id] });
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    return { admin, project: stored, kept };
  }

  async function assertUnchanged(project: { id: string; title: string; updatedAt: Date }, keptId: string) {
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(stored.title, project.title);
    assert.equal(stored.updatedAt.getTime(), project.updatedAt.getTime());
    assert.deepEqual(await assignments({ projectId: project.id }), [`${project.id}:${keptId}`]);
    assert.equal(await prisma.projectMedia.count({ where: { projectId: project.id } }), 0);
  }

  it("rolls back the field change and the media step when a submitted video is not READY", async () => {
    const { admin, project, kept } = await assignedProject();
    const processing = await seedVideo(admin, "PROCESSING");
    await assert.rejects(save(project.id, { title: "Must not persist", videoIds: [kept.id, processing.id] }), ProjectVideoAssignmentError);
    await assertUnchanged(project, kept.id);
  });

  it("rolls back the field change when a later statement fails on a foreign key", async () => {
    const { project, kept } = await assignedProject();
    await assert.rejects(save(project.id, { title: "Must not persist", mediaIds: [randomUUID()], videoIds: [] }));
    await assertUnchanged(project, kept.id);
  });

  it("refuses a stale version without writing", async () => {
    const { project, kept } = await assignedProject();
    const stale = await saveInput(project.id, { title: "Must not persist", videoIds: [] });
    await save(project.id, { title: "Concurrent edit", videoIds: [kept.id] });
    const current = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    await assert.rejects(runProjectSave(prisma, stale, { manageVideos: true }), ProjectConflictError);
    await assertUnchanged(current, kept.id);
  });

  it("creates nothing when a new project's insert fails", async () => {
    const { project } = await assignedProject();
    const input = projectSchema.parse(await formValues(project.id, { id: undefined, expectedUpdatedAt: undefined, title: "Duplicate slug" }));
    await assert.rejects(runProjectSave(prisma, input, { manageVideos: true }));
    assert.equal(await prisma.project.count({ where: { title: "Duplicate slug", categoryId } }), 0);
  });
});
