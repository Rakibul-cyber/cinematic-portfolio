import "server-only";

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { headers } from "next/headers";

import { describeDatabaseError } from "@/lib/diagnostics/database-error";
import {
  DIAGNOSTIC_VERSION,
  lookupDatabaseIdentity,
} from "@/lib/diagnostics/database-identity";
import { getServerEnv } from "@/server/env";

/**
 * TEMPORARY DIAGNOSTIC (project save failure). Remove this file, its pure
 * helpers in `src/lib/diagnostics/`, and the single call in `saveProject`
 * once the cause is known.
 *
 * Writes one `[diag:db-error]` JSON line per failed database operation:
 * the diagnostic version, which step failed, the Prisma and PostgreSQL codes,
 * the column, relation and constraint names, and the identity of the database
 * the runtime is connected to (Neon endpoint id, database, schema, whether it
 * sees `project.categoryId` as nullable, and its latest applied migration).
 * No SQL, no parameters, no message text, no credentials, no user data.
 *
 * The identity query runs on the Neon serverless driver over HTTP, with the
 * same configured `DATABASE_URL` Prisma uses, so Prisma's raw-query
 * deserialization is not involved. It is a separate connection from the
 * failed Prisma operation (see `DATABASE_IDENTITY_SQL`).
 *
 * Log line versions: v1 (`5ac4412`) and v2 (`020905a`) have no
 * `diagnosticVersion` or `endpointId` field; v3 has both.
 */
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

async function correlationId(): Promise<string> {
  try {
    const value = (await headers()).get("x-nf-request-id");
    if (value && REQUEST_ID.test(value)) return value;
  } catch {
    // Outside a request (tests, scripts): fall through.
  }
  return randomUUID();
}

export async function logDatabaseFailure(
  operation: string,
  error: unknown,
): Promise<void> {
  try {
    const connectionString = getServerEnv().DATABASE_URL;
    const [id, identity] = await Promise.all([
      correlationId(),
      lookupDatabaseIdentity(connectionString, (sql) =>
        neon(connectionString).query(sql),
      ),
    ]);
    console.error(
      "[diag:db-error]",
      JSON.stringify({
        diagnosticVersion: DIAGNOSTIC_VERSION,
        correlationId: id,
        operation,
        ...describeDatabaseError(error),
        ...identity,
      }),
    );
  } catch {
    // A diagnostic must never change the outcome of the request.
  }
}
