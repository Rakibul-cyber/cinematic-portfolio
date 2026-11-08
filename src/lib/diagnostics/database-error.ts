/**
 * TEMPORARY DIAGNOSTIC (project save failure). Remove with
 * `src/server/diagnostics/database-failure.ts` once the cause is known.
 *
 * Reduces a Prisma error to identifiers that are safe to log. The Neon driver
 * adapter drops the column of a PostgreSQL not-null violation (it looks for
 * `Key (...)`, which only unique violations carry), so Prisma reports P2011 as
 * "(not available)". The original PostgreSQL message survives on
 * `meta.driverAdapterError.cause.originalMessage`; only quoted identifiers are
 * read from it. The message itself is never returned, because other PostgreSQL
 * errors (for example invalid input syntax) embed submitted values.
 */
export type SafeDatabaseError = {
  errorName: string;
  prismaCode: string | null;
  adapterKind: string | null;
  sqlState: string | null;
  column: string | null;
  relation: string | null;
  constraint: string | null;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const SQL_STATE = /^[0-9A-Z]{5}$/;
const PRISMA_CODE = /^P\d{4}$/;
const ADAPTER_KIND = /^[A-Za-z]{1,64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function quoted(message: string, word: string): string | null {
  const found = message.match(new RegExp(`\\b${word} "([^"]{1,63})"`));
  return found ? matching(found[1], IDENTIFIER) : null;
}

export function describeDatabaseError(error: unknown): SafeDatabaseError {
  const top = record(error);
  const cause = record(record(record(top?.meta)?.driverAdapterError)?.cause);
  const message =
    typeof cause?.originalMessage === "string" ? cause.originalMessage : "";
  const name =
    error instanceof Error ? error.constructor.name || error.name : "unknown";

  return {
    errorName: matching(name, ADAPTER_KIND) ?? "unknown",
    prismaCode: matching(top?.code, PRISMA_CODE),
    adapterKind: matching(cause?.kind, ADAPTER_KIND),
    sqlState: matching(cause?.originalCode, SQL_STATE),
    column: quoted(message, "column"),
    relation: quoted(message, "relation"),
    constraint: quoted(message, "constraint"),
  };
}
