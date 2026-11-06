import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { VIDEO_STATUSES } from "@/lib/video-status";

/**
 * Static checks on the P3-11C schema and its offline-generated migration. The
 * migration has NOT been applied anywhere; database verification is BLOCKED by
 * P4-03.
 */

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION_DIR = "20261106120000_add_uploaded_video";
const migration = readFileSync(join(ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql"), "utf8");
const statements = migration
  .replace(/--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("video schema and migration", () => {
  it("uses exactly the seven application statuses, in order", () => {
    const block = /enum VideoStatus \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    assert.deepEqual(block.split(/\s+/).filter(Boolean), [...VIDEO_STATUSES]);
    const values = VIDEO_STATUSES.map((status) => `'${status}'`).join(", ");
    assert.ok(migration.includes(`CREATE TYPE "VideoStatus" AS ENUM (${values})`));
  });

  it("is the newest migration and purely additive", () => {
    const directories = readdirSync(join(ROOT, "prisma", "migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
    assert.equal(directories.at(-1), MIGRATION_DIR);
    // Foreign-key actions ("ON DELETE RESTRICT") are not data changes; everything else is checked.
    const sql = statements.join(";\n").replace(/\bON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)\b/g, "");
    assert.doesNotMatch(sql, /\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE|ALTER\s+TYPE|ALTER\s+COLUMN)\b/i);
    for (const statement of statements) {
      assert.match(
        statement,
        /^(CREATE TYPE "VideoStatus"|CREATE TABLE "(video|project_video)"|CREATE (UNIQUE )?INDEX "\w+" ON "(video|project_video)"|ALTER TABLE "(video|project_video)" ADD CONSTRAINT)/,
        statement.slice(0, 80),
      );
    }
  });

  it("keeps credentials out and enforces identity, ownership, and deletion safety", () => {
    assert.doesNotMatch(migration, /upload_?url|token|secret/i);
    assert.match(migration, /CREATE UNIQUE INDEX "video_muxUploadId_key"/);
    assert.match(migration, /CREATE UNIQUE INDEX "video_muxAssetId_key"/);
    assert.match(migration, /CREATE UNIQUE INDEX "video_playbackId_key"/);
    assert.match(migration, /"declaredSizeBytes" BIGINT NOT NULL/);
    assert.match(migration, /"project_video_videoId_fkey" FOREIGN KEY \("videoId"\) REFERENCES "video"\("id"\) ON DELETE RESTRICT/);
    assert.match(migration, /"project_video_projectId_fkey" FOREIGN KEY \("projectId"\) REFERENCES "project"\("id"\) ON DELETE CASCADE/);
    assert.match(migration, /"video_uploaderId_fkey" FOREIGN KEY \("uploaderId"\) REFERENCES "user"\("id"\) ON DELETE RESTRICT/);
    assert.match(migration, /CREATE INDEX "video_uploaderId_status_uploadExpiresAt_idx"/);
  });
});
