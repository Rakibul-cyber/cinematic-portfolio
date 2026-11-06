import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@/generated/prisma/client";
import {
  PrismaVideoRepository,
  lockVideoRowSql,
  toVideoRecord,
  uploaderLockKey,
  uploaderLockSql,
  type VideoPrismaClient,
} from "@/server/video/prisma-repository";
import type { VideoRecord } from "@/server/video/repository";

/**
 * The Prisma adapter against a recording fake client. This checks which
 * statements run, in which transaction, and in which order. It cannot prove
 * PostgreSQL's locking behaviour: that needs the disposable-database run
 * (P4-03, BLOCKED). The fake emulates `pg_advisory_xact_lock` as a per-key
 * mutex held until the transaction ends, which is the documented semantics.
 */

const NOW = new Date("2027-01-15T10:00:00.000Z");
const LATER = new Date("2027-01-15T16:00:00.000Z");

type Row = Omit<VideoRecord, "declaredSizeBytes"> & { declaredSizeBytes: bigint };
type Call = { op: string; tx: number | null; args?: unknown };

function record(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Reel",
    originalFilename: "reel.mp4",
    declaredSizeBytes: 10 * 1024 ** 3,
    status: "UPLOAD_PENDING",
    uploaderId: "user-a",
    muxUploadId: "UploadId00000001",
    muxAssetId: null,
    playbackId: null,
    durationSeconds: null,
    width: null,
    height: null,
    maxResolution: null,
    failureCode: null,
    uploadExpiresAt: LATER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const notFound = () => new Prisma.PrismaClientKnownRequestError("No record was found.", { code: "P2025", clientVersion: "test" });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeClient(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const calls: Call[] = [];
  const locks = new Map<string, Promise<void>>();
  let nextTx = 0;

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "gt" in value) return (row[key as keyof Row] as Date) > (value as { gt: Date }).gt;
      return row[key as keyof Row] === value;
    });

  const videoDelegate = (tx: number | null) => ({
    async findUnique(args: { where: Record<string, unknown> }) {
      calls.push({ op: "video.findUnique", tx, args });
      return rows.find((row) => matches(row, args.where)) ?? null;
    },
    async count(args: { where: Record<string, unknown> }) {
      calls.push({ op: "video.count", tx, args });
      await tick(); // let concurrent transactions interleave
      return rows.filter((row) => matches(row, args.where)).length;
    },
    async create(args: { data: Row }) {
      calls.push({ op: "video.create", tx, args });
      await tick();
      rows.push({ ...args.data });
      return { ...args.data };
    },
    async update(args: { where: Record<string, unknown>; data: Partial<Row> }) {
      calls.push({ op: "video.update", tx, args });
      const row = rows.find((candidate) => matches(candidate, args.where));
      if (!row) throw notFound();
      Object.assign(row, args.data);
      return { ...row };
    },
  });

  const client = {
    async $transaction(run: (tx: unknown) => Promise<unknown>) {
      const tx = (nextTx += 1);
      calls.push({ op: "begin", tx });
      const held: Array<() => void> = [];
      const txClient = {
        async $queryRaw(sql: Prisma.Sql) {
          calls.push({ op: "lock", tx, args: { sql: sql.text, values: sql.values } });
          const key = String(sql.values[0]);
          while (locks.has(key)) await locks.get(key);
          let release!: () => void;
          locks.set(key, new Promise<void>((resolve) => (release = resolve)));
          held.push(() => {
            locks.delete(key);
            release();
          });
          return [{ locked: 1 }];
        },
        video: videoDelegate(tx),
      };
      try {
        return await run(txClient);
      } finally {
        calls.push({ op: "commit", tx });
        for (const unlock of held) unlock();
      }
    },
    video: videoDelegate(null),
    projectVideo: {
      async findMany(args: unknown) {
        calls.push({ op: "projectVideo.findMany", tx: null, args });
        return [
          { projectId: "p-1", project: { status: "PUBLISHED", category: { isActive: true } } },
          { projectId: "p-2", project: { status: "DRAFT", category: { isActive: false } } },
        ];
      },
    },
  };
  return { client: client as unknown as VideoPrismaClient, rows, calls };
}

const asRow = (value: VideoRecord): Row => ({ ...value, declaredSizeBytes: BigInt(value.declaredSizeBytes) });

describe("PrismaVideoRepository: active-upload limit", () => {
  it("locks the uploader, then counts and inserts inside the same transaction", async () => {
    const { client, calls, rows } = fakeClient();
    const repository = new PrismaVideoRepository(client);
    assert.equal(await repository.insertWithinActiveLimit(record(), 2, NOW), "inserted");
    assert.deepEqual(calls.map((call) => [call.op, call.tx]), [["begin", 1], ["lock", 1], ["video.count", 1], ["video.create", 1], ["commit", 1]]);
    const lock = calls[1]!.args as { sql: string; values: unknown[] };
    assert.match(lock.sql, /pg_advisory_xact_lock\(\$1\)/);
    assert.deepEqual(lock.values, [uploaderLockKey("user-a")]);
    assert.deepEqual((calls[2]!.args as { where: unknown }).where, { uploaderId: "user-a", status: "UPLOAD_PENDING", uploadExpiresAt: { gt: NOW } });
    assert.equal(rows[0]!.declaredSizeBytes, BigInt(10 * 1024 ** 3), "stored as BIGINT; 10 GiB exceeds INTEGER");
  });

  it("does not insert at the limit", async () => {
    const { client, calls, rows } = fakeClient([
      asRow(record({ id: "a", muxUploadId: "UploadIdA0000001" })),
      asRow(record({ id: "b", muxUploadId: "UploadIdB0000001" })),
    ]);
    assert.equal(await new PrismaVideoRepository(client).insertWithinActiveLimit(record({ id: "c", muxUploadId: "UploadIdC0000001" }), 2, NOW), "limit_reached");
    assert.equal(calls.some((call) => call.op === "video.create"), false);
    assert.equal(rows.length, 2);
  });

  it("admits exactly `limit` concurrent inserts for one uploader under the transaction lock", async () => {
    const { client, rows } = fakeClient();
    const repository = new PrismaVideoRepository(client);
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => repository.insertWithinActiveLimit(record({ id: `id-${n}`, muxUploadId: `UploadIdConc000${n}` }), 2, NOW)),
    );
    assert.equal(results.filter((result) => result === "inserted").length, 2);
    assert.equal(rows.length, 2);
  });

  it("does not serialize different uploaders on one key", () => {
    assert.notEqual(uploaderLockKey("user-a"), uploaderLockKey("user-b"));
    assert.equal(uploaderLockKey("user-a"), uploaderLockKey("user-a"));
    assert.equal(typeof uploaderLockKey("user-a"), "bigint");
    assert.ok(!uploaderLockSql("user-a").text.includes("user-a"), "the id is a bound parameter, never SQL text");
  });

  it("rejects a non-positive limit", async () => {
    const { client } = fakeClient();
    await assert.rejects(new PrismaVideoRepository(client).insertWithinActiveLimit(record(), 0, NOW), RangeError);
  });
});

describe("PrismaVideoRepository: conditional transitions", () => {
  it("updates only while the status still matches, in one statement", async () => {
    const { client, calls } = fakeClient([asRow(record({ status: "PROCESSING" }))]);
    const repository = new PrismaVideoRepository(client);
    const updated = await repository.updateIfStatus(record().id, "PROCESSING", { status: "READY", playbackId: "SignedPlayback0001" }, LATER);
    assert.equal(updated?.status, "READY");
    assert.equal(updated?.playbackId, "SignedPlayback0001");
    const update = calls.find((call) => call.op === "video.update")!.args as { where: unknown; data: unknown };
    assert.deepEqual(update.where, { id: record().id, status: "PROCESSING" });
    assert.deepEqual(update.data, { updatedAt: LATER, status: "READY", playbackId: "SignedPlayback0001" });
  });

  it("returns null for a stale expected status and leaves the row alone", async () => {
    const { client, rows } = fakeClient([asRow(record({ status: "CANCELLED" }))]);
    assert.equal(await new PrismaVideoRepository(client).updateIfStatus(record().id, "PROCESSING", { status: "READY" }, LATER), null);
    assert.equal(rows[0]!.status, "CANCELLED");
  });

  it("never patches identity or ownership columns", async () => {
    const { client, calls } = fakeClient([asRow(record({ status: "PROCESSING" }))]);
    const hostile = { status: "READY", uploaderId: "attacker", muxUploadId: "UploadIdHostile01", id: "other" } as never;
    await new PrismaVideoRepository(client).updateIfStatus(record().id, "PROCESSING", hostile, LATER);
    assert.deepEqual((calls.find((call) => call.op === "video.update")!.args as { data: unknown }).data, { updatedAt: LATER, status: "READY" });
  });

  it("rethrows other database errors for the service to answer as retryable", async () => {
    const { client } = fakeClient();
    (client.video as unknown as { update: () => Promise<never> }).update = async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    };
    await assert.rejects(new PrismaVideoRepository(client).updateIfStatus(record().id, "PROCESSING", { status: "READY" }, LATER));
  });
});

describe("PrismaVideoRepository: reads", () => {
  it("maps rows to records and refuses unknown statuses or unsafe sizes", () => {
    const mapped = toVideoRecord({ ...asRow(record()), failureCode: "provider said <b>no</b>" });
    assert.equal(mapped.declaredSizeBytes, 10 * 1024 ** 3);
    assert.equal(mapped.failureCode, "processing_failed", "stored text is reduced to a known code");
    assert.throws(() => toVideoRecord({ ...asRow(record()), status: "PUBLISHED" }));
    assert.throws(() => toVideoRecord({ ...asRow(record()), declaredSizeBytes: BigInt("1152921504606846976") }));
  });

  it("looks up by id, upload ID, and asset ID, and counts unexpired pending uploads", async () => {
    const { client, calls } = fakeClient([asRow(record({ muxAssetId: "AssetId00000001" }))]);
    const repository = new PrismaVideoRepository(client);
    assert.equal((await repository.findById(record().id))?.id, record().id);
    assert.equal((await repository.findByMuxUploadId("UploadId00000001"))?.id, record().id);
    assert.equal((await repository.findByMuxAssetId("AssetId00000001"))?.id, record().id);
    assert.equal(await repository.findById("missing"), null);
    assert.equal(await repository.countActiveUploads("user-a", NOW), 1);
    assert.equal(await repository.countActiveUploads("user-a", LATER), 0, "expired uploads do not count");
    assert.deepEqual(
      calls.filter((call) => call.op === "video.findUnique").map((call) => (call.args as { where: unknown }).where),
      [{ id: record().id }, { muxUploadId: "UploadId00000001" }, { muxAssetId: "AssetId00000001" }, { id: "missing" }],
    );
  });

  it("returns project assignments with the publication facts", async () => {
    const { client, calls } = fakeClient();
    assert.deepEqual(await new PrismaVideoRepository(client).listProjectAssignments("v"), [
      { projectId: "p-1", projectStatus: "PUBLISHED", categoryActive: true },
      { projectId: "p-2", projectStatus: "DRAFT", categoryActive: false },
    ]);
    assert.deepEqual((calls[0]!.args as { where: unknown }).where, { videoId: "v" });
  });

  it("offers a row lock for deletion and assignment to coordinate on", () => {
    const sql = lockVideoRowSql("vid");
    assert.match(sql.text, /FROM "video" WHERE "id" = \$1 FOR UPDATE$/);
    assert.deepEqual(sql.values, ["vid"]);
  });
});
