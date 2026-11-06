import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Prisma } from "@/generated/prisma/client";
import { projectSchema } from "@/lib/validation/cms";
import { AdminRole, isAdministrative } from "@/server/auth/roles";
import {
  describeVideoChange,
  lockVideosForAssignmentSql,
  ProjectConflictError,
  ProjectVideoAssignmentError,
  replaceProjectVideos,
  runProjectSave,
  type ProjectSaveClient,
  type ProjectSaveData,
} from "@/server/cms/project-save";
import { PrismaVideoRepository, type VideoPrismaClient } from "@/server/video/prisma-repository";

/**
 * Project save with uploaded videos (P3-11E), against a small fake database.
 *
 * The fake models what the locking argument relies on: `SELECT … FOR UPDATE`
 * takes a per-row lock held until commit or rollback; a statement sees
 * committed rows plus its own transaction's writes (READ COMMITTED); a row
 * locked after waiting is read again as last committed; writes are discarded
 * on rollback. The real `replaceProjectVideos` and the real
 * `PrismaVideoRepository.beginDeletion` run against it, so the race tests
 * exercise the production statement order. PostgreSQL itself is NOT used:
 * the same scenarios still need the disposable-database run (P4-03, BLOCKED).
 */

const NOW = new Date("2027-03-01T12:00:00.000Z");
const STALE_BEFORE = new Date(NOW.getTime() - 5 * 60_000);
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const M1 = "44444444-4444-4444-8444-444444444444";
const M2 = "55555555-5555-4555-8555-555555555555";
const CATEGORY = "66666666-6666-4666-8666-666666666666";
const VERSION = new Date("2027-03-01T10:00:00.000Z");

type VideoRow = {
  id: string;
  title: string;
  originalFilename: string;
  declaredSizeBytes: bigint;
  status: string;
  uploaderId: string;
  muxUploadId: string;
  muxAssetId: string | null;
  playbackId: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
  failureCode: string | null;
  uploadExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
type Assignment = { projectId: string; videoId: string; sortOrder: number };
type MediaRow = { projectId: string; mediaId: string; sortOrder: number; role: string };
type ProjectRow = { id: string; updatedAt: Date; [key: string]: unknown };

function videoRow(id: string, status: string, title = `Video ${id.slice(0, 1)}`): VideoRow {
  return {
    id,
    title,
    originalFilename: "film.mp4",
    declaredSizeBytes: BigInt(1000),
    status,
    uploaderId: "admin-1",
    muxUploadId: `Upload${id.slice(0, 8)}`,
    muxAssetId: `Asset${id.slice(0, 8)}`,
    playbackId: status === "READY" ? `Playback${id.slice(0, 8)}` : null,
    durationSeconds: 60,
    width: 1920,
    height: 1080,
    maxResolution: "1080p",
    failureCode: null,
    uploadExpiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A per-key lock held until the owning transaction ends. */
class RowLocks {
  readonly #held = new Map<string, Promise<void>>();
  async acquire(key: string): Promise<() => void> {
    while (this.#held.has(key)) await this.#held.get(key);
    let release!: () => void;
    this.#held.set(key, new Promise<void>((done) => (release = () => {
      this.#held.delete(key);
      done();
    })));
    return release;
  }
}

type Pending = {
  video: Map<string, Partial<VideoRow>>;
  assignmentOps: Array<{ kind: "delete"; projectId: string } | { kind: "create"; rows: Assignment[] }>;
  media: Array<{ kind: "delete"; projectId: string } | { kind: "create"; rows: MediaRow[] }>;
  projects: Map<string, ProjectRow>;
  releases: Array<() => void>;
};

class FakeDatabase {
  readonly videos = new Map<string, VideoRow>();
  assignments: Assignment[] = [];
  media: MediaRow[] = [];
  readonly projects = new Map<string, ProjectRow>();
  readonly locks = new RowLocks();
  /** Statement log: `<tx>:<statement>`. */
  readonly log: string[] = [];
  /** Optional pause after a lock statement, keyed "assign" or "delete". */
  readonly pauseAfterLock = new Map<string, Promise<void>>();
  #txCount = 0;

  seedVideo(row: VideoRow) {
    this.videos.set(row.id, row);
  }
  seedProject(id: string) {
    this.projects.set(id, { id, updatedAt: VERSION, title: "Project" });
  }

  async $transaction<T>(run: (tx: ReturnType<FakeDatabase["txClient"]>) => Promise<T>): Promise<T> {
    const name = `tx${++this.#txCount}`;
    const pending: Pending = { video: new Map(), assignmentOps: [], media: [], projects: new Map(), releases: [] };
    try {
      const result = await run(this.txClient(name, pending));
      this.#commit(pending);
      this.log.push(`${name}:commit`);
      return result;
    } catch (error) {
      this.log.push(`${name}:rollback`);
      throw error;
    } finally {
      for (const release of pending.releases) release();
    }
  }

  #commit(pending: Pending) {
    for (const [id, patch] of pending.video) this.videos.set(id, { ...this.videos.get(id)!, ...patch });
    this.assignments = this.#applyAssignments(this.assignments, pending.assignmentOps);
    for (const op of pending.media) {
      this.media = op.kind === "delete" ? this.media.filter((row) => row.projectId !== op.projectId) : [...this.media, ...op.rows];
    }
    for (const [id, row] of pending.projects) this.projects.set(id, row);
  }

  #applyAssignments(base: Assignment[], ops: Pending["assignmentOps"]): Assignment[] {
    let rows = [...base];
    for (const op of ops) rows = op.kind === "delete" ? rows.filter((row) => row.projectId !== op.projectId) : [...rows, ...op.rows];
    return rows;
  }

  #videoView(id: string, pending: Pending): VideoRow | undefined {
    const committed = this.videos.get(id);
    return committed ? { ...committed, ...pending.video.get(id) } : undefined;
  }

  txClient(name: string, pending: Pending) {
    const assignmentView = () => this.#applyAssignments(this.assignments, pending.assignmentOps);
    return {
      $queryRaw: async (sql: Prisma.Sql) => {
        const ids = sql.values.filter((value): value is string => typeof value === "string");
        const kind = sql.text.includes(" IN (") ? "assign" : "delete";
        if (sql.text.includes("FOR UPDATE")) {
          const order = sql.text.includes('ORDER BY "id"') ? [...ids].sort() : ids;
          for (const id of order) pending.releases.push(await this.locks.acquire(`video:${id}`));
          this.log.push(`${name}:lock(${kind})`);
          const pause = this.pauseAfterLock.get(kind);
          if (pause) await pause;
        } else {
          this.log.push(`${name}:read(${kind})`);
        }
        // Read after the lock: the latest committed row plus this transaction's own writes.
        return ids.flatMap((id) => {
          const row = this.#videoView(id, pending);
          return row ? [{ id: row.id, status: row.status, title: row.title, updatedAt: row.updatedAt }] : [];
        });
      },
      video: {
        update: async (args: { where: { id: string }; data: Partial<VideoRow> }) => {
          this.log.push(`${name}:video.update`);
          pending.video.set(args.where.id, { ...pending.video.get(args.where.id), ...args.data });
          return this.#videoView(args.where.id, pending)!;
        },
      },
      projectVideo: {
        count: async (args: { where: { videoId: string } }) => {
          this.log.push(`${name}:projectVideo.count`);
          return assignmentView().filter((row) => row.videoId === args.where.videoId).length;
        },
        findMany: async (args: { where: { projectId: string } }) => {
          this.log.push(`${name}:projectVideo.findMany`);
          return assignmentView()
            .filter((row) => row.projectId === args.where.projectId)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.videoId.localeCompare(b.videoId))
            .map((row) => ({ videoId: row.videoId }));
        },
        deleteMany: async (args: { where: { projectId: string } }) => {
          this.log.push(`${name}:projectVideo.deleteMany`);
          pending.assignmentOps.push({ kind: "delete", projectId: args.where.projectId });
          return { count: 0 };
        },
        createMany: async (args: { data: Assignment[] }) => {
          this.log.push(`${name}:projectVideo.createMany`);
          // The foreign key: a missing video fails the insert.
          for (const row of args.data) if (!this.#videoView(row.videoId, pending)) throw new Error("foreign key violation");
          pending.assignmentOps.push({ kind: "create", rows: args.data.map((row) => ({ ...row })) });
          return { count: args.data.length };
        },
      },
      project: {
        updateMany: async (args: { where: { id: string; updatedAt: Date }; data: Record<string, unknown> }) => {
          this.log.push(`${name}:project.updateMany`);
          const row = pending.projects.get(args.where.id) ?? this.projects.get(args.where.id);
          if (!row || row.updatedAt.getTime() !== args.where.updatedAt.getTime()) return { count: 0 };
          pending.projects.set(row.id, { ...row, ...args.data } as ProjectRow);
          return { count: 1 };
        },
        findUniqueOrThrow: async (args: { where: { id: string } }) => {
          this.log.push(`${name}:project.findUniqueOrThrow`);
          const row = pending.projects.get(args.where.id) ?? this.projects.get(args.where.id);
          if (!row) throw new Error("not found");
          return row;
        },
        create: async (args: { data: Record<string, unknown> }) => {
          this.log.push(`${name}:project.create`);
          const row = { id: PROJECT_B, updatedAt: VERSION, ...args.data } as ProjectRow;
          pending.projects.set(row.id, row);
          return row;
        },
      },
      projectMedia: {
        deleteMany: async (args: { where: { projectId: string } }) => {
          this.log.push(`${name}:projectMedia.deleteMany`);
          pending.media.push({ kind: "delete", projectId: args.where.projectId });
          return { count: 0 };
        },
        createMany: async (args: { data: MediaRow[] }) => {
          this.log.push(`${name}:projectMedia.createMany`);
          pending.media.push({ kind: "create", rows: args.data.map((row) => ({ ...row })) });
          return { count: args.data.length };
        },
      },
    };
  }

  /** The client shapes the production code expects. */
  get saveClient(): ProjectSaveClient {
    return this as unknown as ProjectSaveClient;
  }
  get videoClient(): VideoPrismaClient {
    return this as unknown as VideoPrismaClient;
  }
  assignmentsOf(projectId: string): string[] {
    return this.assignments
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => row.videoId);
  }
}

function setup() {
  const db = new FakeDatabase();
  db.seedProject(PROJECT_A);
  db.seedVideo(videoRow(V1, "READY", "Brand film"));
  db.seedVideo(videoRow(V2, "READY", "Behind the scenes"));
  db.seedVideo(videoRow(V3, "READY", "Teaser"));
  return db;
}

function data(overrides: Partial<ProjectSaveData> = {}): ProjectSaveData {
  return projectSchema.parse({
    id: PROJECT_A,
    expectedUpdatedAt: VERSION.toISOString(),
    title: "Harbour Light",
    slug: "harbour-light",
    summary: "A summary.",
    description: "A description.",
    clientName: "",
    location: "",
    seoTitle: "",
    seoDescription: "",
    projectDate: "",
    categoryId: CATEGORY,
    status: "PUBLISHED",
    featured: false,
    sortOrder: 0,
    videoProvider: "",
    videoId: "",
    videoTitle: "",
    mediaIds: [M1, M2],
    ...overrides,
  });
}

const save = (db: FakeDatabase, overrides: Partial<ProjectSaveData> = {}, manageVideos = true) =>
  runProjectSave(db.saveClient, data(overrides), { manageVideos });

// ------------------------------------------------------------------ assignment

describe("project save: adding uploaded videos", () => {
  it("adds READY videos in the submitted order, in the same transaction as the project and images", async () => {
    const db = setup();
    const result = await save(db, { videoIds: [V2, V1] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V2, V1]);
    assert.deepEqual(
      db.assignments.filter((row) => row.projectId === PROJECT_A).map((row) => [row.videoId, row.sortOrder]),
      [[V2, 0], [V1, 1]],
    );
    assert.deepEqual(result.videoChange, { added: [V2, V1], removed: [], reordered: false, count: 2 });
    const tx = db.log.filter((entry) => entry.startsWith("tx1:"));
    assert.deepEqual(tx, [
      "tx1:project.updateMany",
      "tx1:project.findUniqueOrThrow",
      "tx1:projectMedia.deleteMany",
      "tx1:projectMedia.createMany",
      "tx1:lock(assign)",
      "tx1:projectVideo.findMany",
      "tx1:projectVideo.deleteMany",
      "tx1:projectVideo.createMany",
      "tx1:commit",
    ]);
  });

  it("locks the submitted rows with FOR UPDATE, in id order, before reading their status", () => {
    const sql = lockVideosForAssignmentSql([V1, V2]);
    assert.match(sql.text, /^SELECT "id", "status", "title" FROM "video" WHERE "id" IN \(\$1,\$2\) ORDER BY "id" FOR UPDATE$/);
    assert.deepEqual(sql.values, [V1, V2]);
  });

  it("passes the ids to the lock sorted, whatever the display order", async () => {
    const db = setup();
    let seen: unknown[] = [];
    const client = {
      async $transaction(run: (tx: unknown) => Promise<unknown>) {
        return db.$transaction((tx) =>
          run({
            ...tx,
            async $queryRaw(sql: Prisma.Sql) {
              seen = sql.values;
              return tx.$queryRaw(sql);
            },
          }),
        );
      },
    } as unknown as ProjectSaveClient;
    await runProjectSave(client, data({ videoIds: [V3, V1, V2] }), { manageVideos: true });
    assert.deepEqual(seen, [V1, V2, V3]);
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V3, V1, V2], "display order is kept");
  });

  for (const status of ["UPLOAD_PENDING", "PROCESSING", "FAILED", "CANCELLED", "DELETING", "DELETE_FAILED"]) {
    it(`refuses a ${status} video and rolls the whole save back`, async () => {
      const db = setup();
      db.seedVideo(videoRow(V3, status, "Teaser"));
      db.assignments = [{ projectId: PROJECT_A, videoId: V1, sortOrder: 0 }];
      await assert.rejects(save(db, { title: "Changed", videoIds: [V1, V3] }), (error: unknown) => {
        assert.ok(error instanceof ProjectVideoAssignmentError);
        assert.match(error.message, /“Teaser” cannot be added/);
        return true;
      });
      assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1], "assignments unchanged");
      assert.equal(db.projects.get(PROJECT_A)?.title, "Project", "project fields unchanged");
      assert.deepEqual(db.media, [], "images unchanged");
      assert.ok(db.log.includes("tx1:rollback"));
    });
  }

  it("refuses an unknown video id (for example a deleted one) without trusting the client", async () => {
    const db = setup();
    const unknown = "99999999-9999-4999-8999-999999999999";
    await assert.rejects(save(db, { videoIds: [V1, unknown] }), ProjectVideoAssignmentError);
    assert.deepEqual(db.assignmentsOf(PROJECT_A), []);
  });

  it("rejects malformed, duplicate, or too many ids at validation", () => {
    assert.throws(() => data({ videoIds: ["not-a-uuid"] }));
    assert.throws(() => data({ videoIds: [V1, V1] }), /only be added to a project once/);
    const many = Array.from({ length: 21 }, (_, index) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`);
    assert.throws(() => data({ videoIds: many }));
    assert.equal(data().videoIds, undefined, "absent means unchanged");
    assert.deepEqual(data({ videoIds: [] }).videoIds, []);
  });

  it("refuses duplicates even if validation is bypassed", async () => {
    const db = setup();
    await db.$transaction(async (tx) => {
      await assert.rejects(replaceProjectVideos(tx as never, PROJECT_A, [V1, V1]), ProjectVideoAssignmentError);
    }).catch(() => undefined);
    assert.deepEqual(db.assignmentsOf(PROJECT_A), []);
  });
});

describe("project save: removing and reordering", () => {
  it("removes a video from the project without touching the video itself", async () => {
    const db = setup();
    db.assignments = [
      { projectId: PROJECT_A, videoId: V1, sortOrder: 0 },
      { projectId: PROJECT_A, videoId: V2, sortOrder: 1 },
    ];
    const result = await save(db, { videoIds: [V2] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V2]);
    assert.equal(db.videos.get(V1)?.status, "READY", "the removed video stays in the library");
    assert.ok(!db.log.some((entry) => entry.includes("video.update") || entry.includes("video.delete")));
    assert.deepEqual(result.videoChange, { added: [], removed: [V1], reordered: false, count: 1 });
  });

  it("removes every video when the section is submitted empty", async () => {
    const db = setup();
    db.assignments = [{ projectId: PROJECT_A, videoId: V1, sortOrder: 0 }];
    await save(db, { videoIds: [] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), []);
    assert.ok(!db.log.includes("tx1:lock(assign)"), "nothing to lock");
    assert.equal(db.videos.size, 3);
  });

  it("reorders, storing the new sortOrder", async () => {
    const db = setup();
    db.assignments = [
      { projectId: PROJECT_A, videoId: V1, sortOrder: 0 },
      { projectId: PROJECT_A, videoId: V2, sortOrder: 1 },
      { projectId: PROJECT_A, videoId: V3, sortOrder: 2 },
    ];
    const result = await save(db, { videoIds: [V3, V1, V2] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V3, V1, V2]);
    assert.deepEqual(result.videoChange, { added: [], removed: [], reordered: true, count: 3 });
  });

  it("writes nothing for videos when the order is unchanged", async () => {
    const db = setup();
    db.assignments = [{ projectId: PROJECT_A, videoId: V1, sortOrder: 0 }];
    const result = await save(db, { videoIds: [V1] });
    assert.equal(result.videoChange, null);
    assert.ok(!db.log.includes("tx1:projectVideo.deleteMany"));
  });

  it("describes changes", () => {
    assert.equal(describeVideoChange([V1, V2], [V1, V2]), null);
    assert.deepEqual(describeVideoChange([V1, V2], [V2, V1]), { added: [], removed: [], reordered: true, count: 2 });
    assert.deepEqual(describeVideoChange([V1], [V1, V2]), { added: [V2], removed: [], reordered: false, count: 2 });
    assert.deepEqual(describeVideoChange([V1, V2, V3], [V3, V1]), { added: [], removed: [V2], reordered: true, count: 2 });
  });
});

describe("project save: shared videos and roles", () => {
  it("lets one video be shown by several projects", async () => {
    const db = setup();
    db.seedProject(PROJECT_B);
    await save(db, { videoIds: [V1, V2] });
    await save(db, { id: PROJECT_B, videoIds: [V1] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1, V2]);
    assert.deepEqual(db.assignmentsOf(PROJECT_B), [V1]);
    // Removing it from one project leaves the other.
    await save(db, { id: PROJECT_B, expectedUpdatedAt: db.projects.get(PROJECT_B)!.updatedAt, videoIds: [] });
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1, V2]);
  });

  it("leaves assignments alone when the save may not manage videos (an EDITOR), even with ids submitted", async () => {
    const db = setup();
    db.assignments = [{ projectId: PROJECT_A, videoId: V1, sortOrder: 0 }];
    const result = await save(db, { videoIds: [] }, false);
    assert.equal(result.videoChange, null);
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1]);
    assert.ok(!db.log.some((entry) => entry.includes("projectVideo") || entry.includes("lock")));
  });

  it("derives the video permission from the server-side role: only ADMIN and SUPER_ADMIN manage videos", () => {
    assert.equal(isAdministrative(AdminRole.EDITOR), false);
    assert.equal(isAdministrative(AdminRole.ADMIN), true);
    assert.equal(isAdministrative(AdminRole.SUPER_ADMIN), true);
    // saveProject (which needs the real Prisma client) passes exactly this to runProjectSave.
    const source = readFileSync("src/server/cms/service.ts", "utf8");
    assert.match(source, /runProjectSave\(prisma, data, \{\s*manageVideos: isAdministrative\(actor\.role\),\s*\}\)/);
  });

  it("leaves assignments alone when the form had no video section", async () => {
    const db = setup();
    db.assignments = [{ projectId: PROJECT_A, videoId: V1, sortOrder: 0 }];
    await save(db, {}, true);
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1]);
    assert.ok(!db.log.some((entry) => entry.includes("projectVideo")));
  });

  it("adds videos to a new project in the same transaction", async () => {
    const db = setup();
    const result = await save(db, { id: undefined, expectedUpdatedAt: undefined, videoIds: [V1] });
    assert.equal(result.project.id, PROJECT_B);
    assert.deepEqual(db.assignmentsOf(PROJECT_B), [V1]);
  });
});

describe("project save: images unchanged", () => {
  it("stores images exactly as before, cover first, with or without videos", async () => {
    const without = setup();
    await save(without);
    const withVideos = setup();
    await save(withVideos, { videoIds: [V1] });
    const expected = [
      { projectId: PROJECT_A, mediaId: M1, sortOrder: 0, role: "COVER" },
      { projectId: PROJECT_A, mediaId: M2, sortOrder: 1, role: "GALLERY" },
    ];
    assert.deepEqual(without.media, expected);
    assert.deepEqual(withVideos.media, expected);
  });

  it("still refuses a stale project version before any image or video work", async () => {
    const db = setup();
    await assert.rejects(save(db, { expectedUpdatedAt: new Date("2020-01-01T00:00:00.000Z"), videoIds: [V1] }), ProjectConflictError);
    assert.deepEqual(db.log, ["tx1:project.updateMany", "tx1:rollback"]);
  });
});

// ------------------------------------------------------------------ races

describe("assignment versus deletion (fake row locks; PostgreSQL run BLOCKED, P4-03)", () => {
  const assign = (db: FakeDatabase, projectId: string, ids: string[]) =>
    db.$transaction((tx) => replaceProjectVideos(tx as never, projectId, ids));
  const claim = (db: FakeDatabase, id: string) => new PrismaVideoRepository(db.videoClient).beginDeletion(id, NOW, STALE_BEFORE);

  it("assignment first: the deletion waits for the lock, then sees the assignment and refuses", async () => {
    const db = setup();
    const gate = deferred();
    db.pauseAfterLock.set("assign", gate.promise);
    const assigning = assign(db, PROJECT_A, [V1]);
    await tick();
    let deletionDone = false;
    const deleting = claim(db, V1).finally(() => (deletionDone = true));
    await tick();
    assert.equal(deletionDone, false, "deletion blocked on the row lock");
    gate.resolve();
    await assigning;
    assert.deepEqual(await deleting, { outcome: "refused", reason: "delete_assigned" });
    assert.equal(db.videos.get(V1)?.status, "READY");
    assert.deepEqual(db.assignmentsOf(PROJECT_A), [V1]);
  });

  it("deletion first: the assignment waits for the lock, then sees DELETING and refuses", async () => {
    const db = setup();
    const gate = deferred();
    db.pauseAfterLock.set("delete", gate.promise);
    const deleting = claim(db, V1);
    await tick();
    let assignmentDone = false;
    const assigning = assign(db, PROJECT_A, [V1]).finally(() => (assignmentDone = true));
    await tick();
    assert.equal(assignmentDone, false, "assignment blocked on the row lock");
    gate.resolve();
    assert.equal((await deleting).outcome, "started");
    await assert.rejects(assigning, (error: unknown) => error instanceof ProjectVideoAssignmentError && /deleting/.test(error.message));
    assert.deepEqual(db.assignmentsOf(PROJECT_A), []);
    assert.equal(db.videos.get(V1)?.status, "DELETING");
  });

  it("never leaves a DELETING video assigned, over many random interleavings", async () => {
    for (let run = 0; run < 60; run += 1) {
      const db = setup();
      db.seedProject(PROJECT_B);
      const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 3)));
      const results = await Promise.allSettled([
        jitter().then(() => assign(db, PROJECT_A, [V1, V2])),
        jitter().then(() => assign(db, PROJECT_B, [V2, V1])),
        jitter().then(() => claim(db, V1)),
        jitter().then(() => claim(db, V2)),
      ]);
      for (const id of [V1, V2]) {
        const assigned = db.assignments.some((row) => row.videoId === id);
        const status = db.videos.get(id)?.status;
        assert.ok(!(assigned && status !== "READY"), `run ${run}: ${id} is ${status} and assigned`);
      }
      for (const result of results) {
        if (result.status === "rejected") assert.ok(result.reason instanceof ProjectVideoAssignmentError, String(result.reason));
      }
    }
  });
});
