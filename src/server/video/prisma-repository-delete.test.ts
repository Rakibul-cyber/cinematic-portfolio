import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@/generated/prisma/client";
import { PrismaVideoRepository, type VideoPrismaClient } from "@/server/video/prisma-repository";

/**
 * Deletion and listing statements of the Prisma adapter (P3-11D) against a
 * recording fake client. This checks which statements run, in which
 * transaction, and in which order; PostgreSQL's real row locking and the
 * RESTRICT foreign key are verified only by the disposable-database run
 * (P4-03, BLOCKED).
 */

const NOW = new Date("2027-02-01T12:00:00.000Z");
const STALE_BEFORE = new Date(NOW.getTime() - 5 * 60_000);
const ID = "11111111-1111-4111-8111-111111111111";

type Locked = { id: string; status: string; updatedAt: Date } | null;

function row(status: string) {
  return {
    id: ID,
    title: "Reel",
    originalFilename: "reel.mp4",
    declaredSizeBytes: BigInt(1000),
    status,
    uploaderId: "user-a",
    muxUploadId: "UploadId00000001",
    muxAssetId: "AssetId000000001",
    playbackId: "Playback00000001",
    durationSeconds: 12,
    width: 1920,
    height: 1080,
    maxResolution: "1080p",
    failureCode: null,
    uploadExpiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function fake(locked: Locked, assignments: number) {
  const calls: Array<{ op: string; tx: boolean; args?: unknown }> = [];
  const tx = {
    async $queryRaw(sql: Prisma.Sql) {
      calls.push({ op: "lock", tx: true, args: { text: sql.text, values: sql.values } });
      return locked ? [locked] : [];
    },
    projectVideo: {
      async count(args: unknown) {
        calls.push({ op: "projectVideo.count", tx: true, args });
        return assignments;
      },
    },
    video: {
      async update(args: { data: { status: string } }) {
        calls.push({ op: "video.update", tx: true, args });
        return row(args.data.status);
      },
    },
  };
  const client = {
    async $transaction(run: (client: typeof tx) => Promise<unknown>) {
      calls.push({ op: "begin", tx: true });
      try {
        return await run(tx);
      } finally {
        calls.push({ op: "commit", tx: true });
      }
    },
    video: {
      async deleteMany(args: unknown) {
        calls.push({ op: "video.deleteMany", tx: false, args });
        return { count: locked ? 1 : 0 };
      },
      async findMany(args: unknown) {
        calls.push({ op: "video.findMany", tx: false, args });
        return [{ ...row("READY"), _count: { projects: 2 } }];
      },
    },
  };
  return { repository: new PrismaVideoRepository(client as unknown as VideoPrismaClient), calls };
}

describe("PrismaVideoRepository: beginDeletion", () => {
  it("locks the row, counts assignments, and claims DELETING inside one transaction", async () => {
    const { repository, calls } = fake({ id: ID, status: "READY", updatedAt: NOW }, 0);
    const result = await repository.beginDeletion(ID, NOW, STALE_BEFORE);
    assert.equal(result.outcome, "started");
    assert.deepEqual(calls.map((call) => call.op), ["begin", "lock", "projectVideo.count", "video.update", "commit"]);
    const lock = calls[1]!.args as { text: string; values: unknown[] };
    assert.match(lock.text, /FROM "video" WHERE "id" = \$1 FOR UPDATE$/);
    assert.deepEqual(lock.values, [ID], "the id is a bound parameter");
    assert.deepEqual((calls[2]!.args as { where: unknown }).where, { videoId: ID });
    assert.deepEqual(calls[3]!.args, { where: { id: ID }, data: { status: "DELETING", updatedAt: NOW } });
  });

  it("refuses an assigned video and writes nothing", async () => {
    const { repository, calls } = fake({ id: ID, status: "READY", updatedAt: NOW }, 1);
    assert.deepEqual(await repository.beginDeletion(ID, NOW, STALE_BEFORE), { outcome: "refused", reason: "delete_assigned" });
    assert.equal(calls.some((call) => call.op === "video.update"), false);
  });

  it("refuses an active upload and a fresh DELETING claim, and resumes a stale one", async () => {
    assert.deepEqual(await fake({ id: ID, status: "UPLOAD_PENDING", updatedAt: NOW }, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE), {
      outcome: "refused",
      reason: "delete_upload_in_progress",
    });
    assert.deepEqual(await fake({ id: ID, status: "DELETING", updatedAt: NOW }, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE), {
      outcome: "refused",
      reason: "delete_in_progress",
    });
    const stale = new Date(STALE_BEFORE.getTime() - 1);
    assert.equal((await fake({ id: ID, status: "DELETING", updatedAt: stale }, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE)).outcome, "started");
    assert.deepEqual(await fake({ id: ID, status: "DELETING", updatedAt: stale }, 1).repository.beginDeletion(ID, NOW, STALE_BEFORE), {
      outcome: "refused",
      reason: "delete_assigned",
    });
  });

  it("allows DELETE_FAILED (Retry Delete) and reports a missing row", async () => {
    assert.equal((await fake({ id: ID, status: "DELETE_FAILED", updatedAt: NOW }, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE)).outcome, "started");
    assert.deepEqual(await fake(null, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE), { outcome: "not_found" });
  });

  it("rejects an unknown stored status rather than guessing", async () => {
    await assert.rejects(fake({ id: ID, status: "ARCHIVED", updatedAt: NOW }, 0).repository.beginDeletion(ID, NOW, STALE_BEFORE));
  });
});

describe("PrismaVideoRepository: deleteIfDeleting and listForAdmin", () => {
  it("deletes only while the row is DELETING, in one statement", async () => {
    const { repository, calls } = fake({ id: ID, status: "DELETING", updatedAt: NOW }, 0);
    assert.equal(await repository.deleteIfDeleting(ID), true);
    assert.deepEqual(calls, [{ op: "video.deleteMany", tx: false, args: { where: { id: ID, status: "DELETING" } } }]);
    assert.equal(await fake(null, 0).repository.deleteIfDeleting(ID), false);
  });

  it("lists newest first with assignment counts", async () => {
    const { repository, calls } = fake(null, 0);
    const [item] = await repository.listForAdmin();
    assert.equal(item!.assignmentCount, 2);
    assert.equal(item!.declaredSizeBytes, 1000);
    assert.equal("_count" in item!, false);
    assert.deepEqual(calls[0]!.args, { orderBy: [{ createdAt: "desc" }, { id: "asc" }], include: { _count: { select: { projects: true } } } });
  });
});
