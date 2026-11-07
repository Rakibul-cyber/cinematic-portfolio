/**
 * Offline target checks for the video PostgreSQL suite (MH-09).
 *
 * Nothing here opens a connection. `assessVideoSuiteEnv` decides, from the
 * process environment alone, whether `video.integration.ts` may even load the
 * Prisma client. It reuses the harness's own disposable-target rules
 * (`identity.ts`) and adds the checks that matter for a suite that writes:
 *
 * - the dedicated configuration is complete (the six disposable keys);
 * - the run was confirmed for exactly this branch;
 * - nothing else in the environment could redirect a driver or make the target
 *   ambiguous (PG* variables, other *DATABASE_URL* names, POSTGRES_* names);
 * - nothing looks like production (NODE_ENV, a Netlify build, production-like
 *   names, the declared production endpoint).
 *
 * Refusal reasons name variables and never echo a value.
 */
import {
  assessDisposableTarget,
  DISPOSABLE_ENV_KEYS,
  type Checked,
  type DisposableEnv,
  type DisposableTarget,
} from "./identity";

/** Must equal `DISPOSABLE_NEON_BRANCH_ID`; set only by `integration:run --allow-disposable-writes`. */
export const VIDEO_SUITE_CONFIRM_KEY = "VIDEO_INTEGRATION_CONFIRM_BRANCH";

/** The migration this suite exists to verify; it must already be applied by the harness. */
export const VIDEO_MIGRATION = "20261106120000_add_uploaded_video";

/** Connection variables the suite itself reads. Every other database-looking name is refused. */
const OWN_CONNECTION_KEYS = new Set(["DATABASE_URL", "DATABASE_URL_UNPOOLED"]);

/** Names that could redirect a PostgreSQL driver or name a second database. */
const AMBIGUOUS_NAME = /^(PG[A-Z]+|POSTGRES(_[A-Z0-9_]+)?|NEON_DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|[A-Z0-9_]*DATABASE_URL[A-Z0-9_]*)$/;

/** A database, role, branch, or project name that reads like a live system. */
const PRODUCTION_LIKE = /(^|[^a-z])(prod|production|live|main|primary)([^a-z]|$)/i;

export type VideoSuiteTarget = DisposableTarget & { env: DisposableEnv };

export function assessVideoSuiteEnv(env: Record<string, string | undefined>): Checked<VideoSuiteTarget> {
  const reasons: string[] = [];
  const value = (key: string) => env[key]?.trim() ?? "";

  // 1. The dedicated configuration must be complete.
  const missing = DISPOSABLE_ENV_KEYS.filter((key) => !value(key));
  if (missing.length) reasons.push(`The disposable test database is not configured: ${missing.join(", ")} missing or empty.`);

  // 2. Nothing may look like a production process.
  if (process.env.NODE_ENV === "production" || value("NODE_ENV") === "production") reasons.push("NODE_ENV is production.");
  if (value("NETLIFY") || value("CONTEXT") === "production") reasons.push("This looks like a Netlify build or a production context.");

  // 3. No second database name may be present.
  const ambiguous = Object.keys(env)
    .filter((name) => value(name) && !OWN_CONNECTION_KEYS.has(name) && AMBIGUOUS_NAME.test(name.toUpperCase()))
    .sort();
  if (ambiguous.length) reasons.push(`Other database variables are set (${ambiguous.join(", ")}), so the target is ambiguous; unset them.`);

  // 4. The guard variables of `require-non-production-database`, when present, must agree.
  if (value("DEV_DATABASE_ENDPOINT") && value("DEV_DATABASE_ENDPOINT").toLowerCase() !== value("DISPOSABLE_NEON_ENDPOINT_ID").toLowerCase()) {
    reasons.push("DEV_DATABASE_ENDPOINT and DISPOSABLE_NEON_ENDPOINT_ID disagree.");
  }

  if (missing.length) return { ok: false, reasons };

  const disposable = Object.fromEntries(DISPOSABLE_ENV_KEYS.map((key) => [key, value(key)])) as DisposableEnv;
  const target = assessDisposableTarget(disposable);
  if (!target.ok) reasons.push(...target.reasons);

  // 5. The writes were confirmed for this exact branch.
  if (value(VIDEO_SUITE_CONFIRM_KEY).toLowerCase() !== disposable.DISPOSABLE_NEON_BRANCH_ID.toLowerCase()) {
    reasons.push(`${VIDEO_SUITE_CONFIRM_KEY} must equal DISPOSABLE_NEON_BRANCH_ID; run the suite through integration:run --allow-disposable-writes.`);
  }

  if (target.ok) {
    const t = target.value;
    if (PRODUCTION_LIKE.test(t.database)) reasons.push("The database name looks like production.");
    if (PRODUCTION_LIKE.test(t.user)) reasons.push("The database role looks like production.");
    if (PRODUCTION_LIKE.test(t.projectId)) reasons.push("DISPOSABLE_NEON_PROJECT_ID looks like production.");
  }

  if (reasons.length || !target.ok) return { ok: false, reasons };
  return { ok: true, value: { ...target.value, env: disposable } };
}

/**
 * Decides, from what a read-only connection saw, whether the suite may write.
 * The harness must already have marked the branch and applied every migration,
 * including the video one; an empty or unmarked database is refused.
 */
export function assessVideoSuiteDatabase(observed: { state: "empty" | "marked"; migrations: readonly string[]; expectedMigrations: readonly string[] }): Checked<null> {
  const reasons: string[] = [];
  if (observed.state !== "marked") reasons.push("The database does not carry this run's disposable marker; run the suite through integration:run.");
  if (!observed.migrations.includes(VIDEO_MIGRATION)) reasons.push(`Migration ${VIDEO_MIGRATION} is not applied.`);
  if (JSON.stringify([...observed.migrations].sort()) !== JSON.stringify([...observed.expectedMigrations].sort())) {
    reasons.push("The applied migrations differ from the checkout's migrations.");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, value: null };
}

/** The checkout's migrations, oldest first, and the one under test last. */
export function migrationsBefore(all: readonly string[], target: string = VIDEO_MIGRATION): Checked<string[]> {
  const sorted = [...all].sort();
  const index = sorted.indexOf(target);
  if (index === -1) return { ok: false, reasons: [`Migration ${target} is missing from prisma/migrations.`] };
  if (index !== sorted.length - 1) return { ok: false, reasons: [`Migration ${target} is no longer the latest; review this suite before running it.`] };
  return { ok: true, value: sorted.slice(0, index) };
}

/**
 * Static review of a migration's SQL: additive means it creates new objects and
 * adds keys from new tables only. Comments are stripped before matching.
 */
export function assessAdditiveMigration(sql: string, newTables: readonly string[]): Checked<null> {
  const reasons: string[] = [];
  const statements = sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const isNew = (name: string) => newTables.includes(name);
  for (const statement of statements) {
    // Referential actions are part of a new key, not a data change.
    const keywords = statement.replace(/\bON (DELETE|UPDATE) (CASCADE|RESTRICT|NO ACTION|SET NULL|SET DEFAULT)\b/gi, "");
    if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME|GRANT|REVOKE)\b/i.test(keywords)) {
      reasons.push(`Destructive or privilege statement: ${statement.slice(0, 60)}`);
      continue;
    }
    if (/^CREATE (TYPE|TABLE|UNIQUE INDEX|INDEX)\b/i.test(statement)) {
      const table = /^CREATE TABLE "([^"]+)"/i.exec(statement)?.[1] ?? /\bON "([^"]+)"/i.exec(statement)?.[1];
      if (table && !isNew(table)) reasons.push(`Statement touches the existing table "${table}".`);
      continue;
    }
    const altered = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY/i.exec(statement)?.[1];
    if (altered && isNew(altered)) continue;
    reasons.push(`Unexpected statement: ${statement.slice(0, 60)}`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, value: null };
}
