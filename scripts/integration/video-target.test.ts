import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  assessAdditiveMigration,
  assessVideoSuiteDatabase,
  assessVideoSuiteEnv,
  migrationsBefore,
  VIDEO_MIGRATION,
  VIDEO_SUITE_CONFIRM_KEY,
} from "./video-target";

/**
 * Offline checks for the video PostgreSQL suite's target gate (MH-09). Every
 * host and credential here is fictional; nothing connects anywhere.
 */

const PASSWORD = "fictional-password-0001";
const valid = (): Record<string, string | undefined> => ({
  DATABASE_URL: `postgresql://tester:${PASSWORD}@ep-quiet-sky-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`,
  DATABASE_URL_UNPOOLED: `postgresql://tester:${PASSWORD}@ep-quiet-sky-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require`,
  DISPOSABLE_NEON_PROJECT_ID: "calm-river-123456",
  DISPOSABLE_NEON_BRANCH_ID: "br-test-branch-a1b2c3",
  DISPOSABLE_NEON_ENDPOINT_ID: "ep-quiet-sky-a1b2c3",
  PRODUCTION_DATABASE_ENDPOINT: "ep-other-prod-d4e5f6",
  [VIDEO_SUITE_CONFIRM_KEY]: "br-test-branch-a1b2c3",
  PATH: "/usr/bin",
});

function refused(env: Record<string, string | undefined>, pattern: RegExp) {
  const result = assessVideoSuiteEnv(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reasons.some((reason) => pattern.test(reason)), result.reasons.join(" | "));
  // Reasons name variables, never values.
  assert.equal(result.reasons.join(" ").includes(PASSWORD), false);
  assert.equal(result.reasons.join(" ").includes("quiet-sky"), false);
}

describe("assessVideoSuiteEnv", () => {
  it("accepts a complete, confirmed, disposable configuration", () => {
    const result = assessVideoSuiteEnv(valid());
    assert.equal(result.ok, true, result.ok ? "" : result.reasons.join(" | "));
    if (result.ok) assert.equal(result.value.endpointId, "ep-quiet-sky-a1b2c3");
  });

  it("refuses an empty environment (the state of any accidental run)", () => refused({ PATH: "/usr/bin" }, /not configured/));

  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DISPOSABLE_NEON_BRANCH_ID", "PRODUCTION_DATABASE_ENDPOINT"]) {
    it(`refuses when ${key} is missing`, () => refused({ ...valid(), [key]: undefined }, new RegExp(key)));
  }

  it("refuses without the branch confirmation, or with a different branch", () => {
    refused({ ...valid(), [VIDEO_SUITE_CONFIRM_KEY]: undefined }, new RegExp(VIDEO_SUITE_CONFIRM_KEY));
    refused({ ...valid(), [VIDEO_SUITE_CONFIRM_KEY]: "br-some-other-branch" }, new RegExp(VIDEO_SUITE_CONFIRM_KEY));
  });

  it("refuses the declared production endpoint", () => {
    refused({ ...valid(), PRODUCTION_DATABASE_ENDPOINT: "ep-quiet-sky-a1b2c3" }, /production endpoint/);
  });

  it("refuses URLs that point at different endpoints, or not at the declared one", () => {
    refused({ ...valid(), DATABASE_URL_UNPOOLED: valid().DATABASE_URL_UNPOOLED!.replace("ep-quiet-sky-a1b2c3", "ep-other-prod-d4e5f6") }, /UNPOOLED/);
  });

  it("refuses ambiguous extra database variables", () => {
    refused({ ...valid(), PGHOST: "localhost" }, /PGHOST/);
    refused({ ...valid(), POSTGRES_PRISMA_URL: "postgresql://x" }, /POSTGRES_PRISMA_URL/);
    refused({ ...valid(), NETLIFY_DATABASE_URL: "postgresql://x" }, /NETLIFY_DATABASE_URL/);
    refused({ ...valid(), DEV_DATABASE_ENDPOINT: "ep-some-other-1a2b3c" }, /DEV_DATABASE_ENDPOINT/);
  });

  it("ignores empty extra variables and accepts a matching DEV_DATABASE_ENDPOINT", () => {
    assert.equal(assessVideoSuiteEnv({ ...valid(), PGHOST: "", DEV_DATABASE_ENDPOINT: "ep-quiet-sky-a1b2c3" }).ok, true);
  });

  it("refuses production-looking processes and names", () => {
    refused({ ...valid(), NODE_ENV: "production" }, /NODE_ENV/);
    refused({ ...valid(), NETLIFY: "true" }, /Netlify/);
    refused({ ...valid(), CONTEXT: "production" }, /production context/);
    const prodDb = (url: string) => url.replace("/neondb?", "/portfolio_prod?");
    refused({ ...valid(), DATABASE_URL: prodDb(valid().DATABASE_URL!), DATABASE_URL_UNPOOLED: prodDb(valid().DATABASE_URL_UNPOOLED!) }, /database name looks like production/);
  });

  it("refuses non-Neon, unencrypted, or host-overriding URLs", () => {
    const both = (from: string, to: string) => ({ ...valid(), DATABASE_URL: valid().DATABASE_URL!.replace(from, to), DATABASE_URL_UNPOOLED: valid().DATABASE_URL_UNPOOLED!.replace(from, to) });
    refused(both("sslmode=require", "sslmode=disable"), /sslmode/);
    refused(both("sslmode=require", "sslmode=require&host=db.internal"), /ambiguous/);
    refused(both(".eu-central-1.aws.neon.tech", ".example.com"), /not a Neon host/);
  });
});

describe("assessVideoSuiteDatabase", () => {
  const all = ["a_init", VIDEO_MIGRATION];
  it("accepts a marked database with every migration applied", () => {
    assert.deepEqual(assessVideoSuiteDatabase({ state: "marked", migrations: all, expectedMigrations: all }), { ok: true, value: null });
  });
  it("refuses an empty database, a missing video migration, or a different migration set", () => {
    assert.equal(assessVideoSuiteDatabase({ state: "empty", migrations: all, expectedMigrations: all }).ok, false);
    assert.equal(assessVideoSuiteDatabase({ state: "marked", migrations: ["a_init"], expectedMigrations: all }).ok, false);
    assert.equal(assessVideoSuiteDatabase({ state: "marked", migrations: [...all, "z_unknown"], expectedMigrations: all }).ok, false);
  });
});

describe("the video migration in the checkout", () => {
  const dir = resolve("prisma/migrations");
  const names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  it("is the latest migration, so the scratch-schema replay covers everything before it", () => {
    const previous = migrationsBefore(names);
    assert.equal(previous.ok, true);
    if (previous.ok) assert.equal(previous.value.length, names.length - 1);
  });

  it("is additive: only new types, tables, indexes, and keys from the new tables", () => {
    const sql = readFileSync(join(dir, VIDEO_MIGRATION, "migration.sql"), "utf8");
    assert.deepEqual(assessAdditiveMigration(sql, ["video", "project_video"]), { ok: true, value: null });
  });

  it("the additive check rejects destructive or foreign-table statements", () => {
    for (const sql of [
      'DROP TABLE "project";',
      'ALTER TABLE "project" ADD COLUMN "x" TEXT;',
      'ALTER TABLE "project" ADD CONSTRAINT "k" FOREIGN KEY ("x") REFERENCES "video"("id");',
      'CREATE INDEX "i" ON "project"("title");',
      'UPDATE "user" SET "role" = \'ADMIN\';',
      'ALTER TABLE "video" RENAME TO "clip";',
    ]) {
      assert.equal(assessAdditiveMigration(sql, ["video", "project_video"]).ok, false, sql);
    }
  });

  it("previous migrations replay in a scratch schema: none qualifies public, creates an extension, or sets search_path", () => {
    for (const name of names) {
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      assert.doesNotMatch(sql, /"?public"?\.|CREATE EXTENSION|search_path|ALTER TYPE [^;]* ADD VALUE/i, name);
    }
  });
});

describe("video.integration.ts started without the harness", () => {
  it("refuses before loading a driver and opens no connection", () => {
    const tsx = resolve("node_modules/tsx/dist/cli.mjs");
    const guard = resolve("scripts/integration/network-guard.mjs");
    // A scrubbed environment: no database variable can reach the child.
    const env: Record<string, string> = { INTEGRATION_ALLOWED_HOSTS: "", NODE_OPTIONS: `--import ${new URL(`file:///${guard.replace(/\\/g, "/")}`).href}` };
    for (const name of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
      if (process.env[name]) env[name] = process.env[name]!;
    }
    const result = spawnSync(process.execPath, [tsx, "--conditions=react-server", "scripts/integration/video.integration.ts"], { encoding: "utf8", env: env as unknown as NodeJS.ProcessEnv, timeout: 60_000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /\[video-integration\] Refused\. No connection was opened/);
    assert.doesNotMatch(result.stdout + result.stderr, /# tests|ℹ tests|allowed-/);
  });
});
