/**
 * TEMPORARY DIAGNOSTIC (project save failure). Remove with
 * `src/server/diagnostics/database-failure.ts` once the cause is known.
 *
 * Which database the running server actually writes to, reduced to values
 * that are safe to log: no host, user, password, or query string ever leaves
 * this module.
 */

/**
 * Bumped whenever the diagnostic changes, and written into every log line, so
 * the log itself proves which build produced it.
 */
export const DIAGNOSTIC_VERSION = 3;

/**
 * One read-only statement. Every column is cast to `text`: `current_database()`
 * and `current_schema()` return PostgreSQL's `name` type, which Prisma's
 * driver adapter refuses to deserialize. It is run on the Neon driver, not
 * Prisma, so no Prisma deserialization is involved at all.
 *
 * Connection scope: the query uses the same configured `DATABASE_URL` as
 * Prisma, but it is a SEPARATE connection (one Neon HTTP request), not the
 * pooled WebSocket connection or the rolled-back transaction in which the
 * Prisma operation failed. It therefore shows what that connection string
 * resolves to (endpoint, database, schema, `categoryId` nullability, latest
 * migration) for the same role and default `search_path`; it cannot observe
 * session state that existed only inside the failed transaction.
 */
export const DATABASE_IDENTITY_SQL = `SELECT
  current_database()::text AS database,
  current_schema()::text AS schema,
  (SELECT c.is_nullable::text FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.table_name = 'project'
      AND c.column_name = 'categoryId') AS category_id_nullable,
  (SELECT m.migration_name::text FROM _prisma_migrations m
    WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    ORDER BY m.finished_at DESC LIMIT 1) AS latest_migration`;

export type DatabaseIdentity = {
  endpointId: string | null;
  pooled: boolean | null;
  database: string | null;
  schema: string | null;
  categoryIdNullable: "YES" | "NO" | null;
  latestMigration: string | null;
  identityLookupFailed?: true;
  identityErrorCode?: string | null;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const ENDPOINT_ID = /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIGRATION = /^\d{14}_[a-z0-9_]{1,120}$/;
const SQL_STATE = /^[0-9A-Z]{5}$/;

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * The Neon endpoint (compute) id from a connection string's host, for example
 * `ep-cool-name-a1b2c3d4` from `ep-cool-name-a1b2c3d4-pooler.<region>.neon.tech`.
 * Each endpoint belongs to exactly one branch, so this distinguishes branches
 * that share a database name. Only the validated id is returned.
 */
export function neonEndpoint(connectionString: string | undefined): {
  endpointId: string | null;
  pooled: boolean | null;
} {
  try {
    const label = new URL(connectionString ?? "").hostname.split(".")[0] ?? "";
    const pooled = label.endsWith("-pooler");
    const endpointId = matching(
      pooled ? label.slice(0, -"-pooler".length) : label,
      ENDPOINT_ID,
    );
    return { endpointId, pooled: endpointId ? pooled : null };
  } catch {
    return { endpointId: null, pooled: null };
  }
}

/** Runs `DATABASE_IDENTITY_SQL` through `run` and keeps only validated values. */
export async function lookupDatabaseIdentity(
  connectionString: string | undefined,
  run: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<DatabaseIdentity> {
  const endpoint = neonEndpoint(connectionString);
  try {
    const row = (await run(DATABASE_IDENTITY_SQL))[0] ?? {};
    const nullable = row.category_id_nullable;
    return {
      ...endpoint,
      database: matching(row.database, IDENTIFIER),
      schema: matching(row.schema, IDENTIFIER),
      categoryIdNullable: nullable === "YES" || nullable === "NO" ? nullable : null,
      latestMigration: matching(row.latest_migration, MIGRATION),
    };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      ...endpoint,
      database: null,
      schema: null,
      categoryIdNullable: null,
      latestMigration: null,
      identityLookupFailed: true,
      identityErrorCode: matching(code, SQL_STATE),
    };
  }
}
