import "server-only";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import { Prisma } from "@/generated/prisma/client";
import {
  DATABASE_IDENTITY_SQL,
  describeDatabaseError,
} from "@/lib/diagnostics/database-error";
import { prisma } from "@/server/db/prisma";

/**
 * TEMPORARY DIAGNOSTIC (project save failure). Remove this file, its pure
 * helper in `src/lib/diagnostics/`, and the single call in
 * `saveProject` once the cause is known.
 *
 * Writes one `[diag:db-error]` JSON line per failed database operation:
 * which step failed, the Prisma and PostgreSQL codes, the column, relation and
 * constraint names, and the database and schema the runtime is connected to.
 * No SQL, no parameters, no message text, no credentials, no user data.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
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

async function databaseIdentity() {
  try {
    const rows = await prisma.$queryRaw<
      { database: unknown; schema: unknown }[]
    >(Prisma.raw(DATABASE_IDENTITY_SQL));
    const pick = (value: unknown) =>
      typeof value === "string" && IDENTIFIER.test(value) ? value : null;
    return { database: pick(rows[0]?.database), schema: pick(rows[0]?.schema) };
  } catch {
    return { database: null, schema: null, identityLookupFailed: true };
  }
}

export async function logDatabaseFailure(
  operation: string,
  error: unknown,
): Promise<void> {
  try {
    const [id, identity] = await Promise.all([
      correlationId(),
      databaseIdentity(),
    ]);
    console.error(
      "[diag:db-error]",
      JSON.stringify({
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
