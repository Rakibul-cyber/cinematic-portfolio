/**
 * Offline safety checks for the disposable-Neon integration harness.
 *
 * Nothing here opens a connection. These functions decide, from configuration
 * alone, whether a run may even try to reach a database, and they fail closed:
 * any missing, malformed, ambiguous, or production-looking value is a refusal.
 * Refusal reasons name variables and never echo a value, so a connection string
 * or password cannot leak into a log through this module.
 */
import { readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * The only keys a disposable environment file may contain. Everything else the
 * run needs (auth and rate-limit secrets, test passwords, dummy Turnstile keys)
 * is generated per run, so a real service key has nowhere to come in.
 */
export const DISPOSABLE_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DISPOSABLE_NEON_PROJECT_ID",
  "DISPOSABLE_NEON_BRANCH_ID",
  "DISPOSABLE_NEON_ENDPOINT_ID",
  "PRODUCTION_DATABASE_ENDPOINT",
  // The everyday development endpoint. Protected on its own, never through
  // PRODUCTION_DATABASE_ENDPOINT: a test run may touch neither.
  "PROTECTED_DEVELOPMENT_ENDPOINT",
] as const;

export type DisposableEnvKey = (typeof DISPOSABLE_ENV_KEYS)[number];
export type DisposableEnv = Record<DisposableEnvKey, string>;

export type Checked<T> = { ok: true; value: T } | { ok: false; reasons: string[] };

/** Parses `KEY=VALUE` lines. Unknown, duplicate, or missing keys are refusals. */
export function parseDisposableEnv(text: string): Checked<DisposableEnv> {
  const reasons: string[] = [];
  const values = new Map<string, string>();
  const allowed = new Set<string>(DISPOSABLE_ENV_KEYS);

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      reasons.push(`Line ${index + 1} is not KEY=VALUE.`);
      return;
    }
    const [, key, rawValue] = match as unknown as [string, string, string];
    if (!allowed.has(key)) {
      reasons.push(`${key} is not allowed in the disposable environment file; only ${DISPOSABLE_ENV_KEYS.join(", ")} are.`);
      return;
    }
    if (values.has(key)) {
      reasons.push(`${key} is set more than once.`);
      return;
    }
    let value = rawValue.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values.set(key, value);
  });

  for (const key of DISPOSABLE_ENV_KEYS) {
    if (!values.get(key)?.trim()) reasons.push(`${key} is missing or empty.`);
  }
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, value: Object.fromEntries(values) as DisposableEnv };
}

export type DisposableTarget = {
  projectId: string;
  branchId: string;
  endpointId: string;
  productionEndpointId: string;
  developmentEndpointId: string;
  pooledHost: string;
  directHost: string;
  database: string;
  user: string;
};

const NEON_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const SAFE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

type ParsedUrl = { host: string; firstLabel: string; domain: string; database: string; user: string };

function parseNeonUrl(name: string, value: string, reasons: string[]): ParsedUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    reasons.push(`${name} is not a valid URL.`);
    return null;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    reasons.push(`${name} is not a PostgreSQL URL.`);
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(",") || url.port) {
    reasons.push(`${name} must name exactly one Neon host, without a port.`);
    return null;
  }
  for (const parameter of ["host", "hostaddr", "options", "service"]) {
    if (url.searchParams.has(parameter)) {
      reasons.push(`${name} sets "${parameter}", which makes its target ambiguous.`);
      return null;
    }
  }
  if (!host.endsWith(".neon.tech")) {
    reasons.push(`${name} is not a Neon host (*.neon.tech).`);
    return null;
  }
  const sslMode = url.searchParams.get("sslmode");
  if (!sslMode || !SAFE_SSL_MODES.has(sslMode)) {
    reasons.push(`${name} must set sslmode to require, verify-ca, or verify-full.`);
  }
  if (!url.username || !url.password) reasons.push(`${name} must carry its own user and password.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || database.includes("/")) reasons.push(`${name} must name exactly one database.`);
  const [firstLabel = "", ...rest] = host.split(".");
  return { host, firstLabel, domain: rest.join("."), database, user: decodeURIComponent(url.username) };
}

/**
 * Confirms both connection URLs name the declared disposable endpoint, through
 * its pooled and direct hosts respectively, and that it is not production.
 */
export function assessDisposableTarget(env: DisposableEnv): Checked<DisposableTarget> {
  const reasons: string[] = [];
  const projectId = env.DISPOSABLE_NEON_PROJECT_ID.trim().toLowerCase();
  const branchId = env.DISPOSABLE_NEON_BRANCH_ID.trim().toLowerCase();
  const endpointId = env.DISPOSABLE_NEON_ENDPOINT_ID.trim().toLowerCase();
  const productionEndpointId = env.PRODUCTION_DATABASE_ENDPOINT.trim().toLowerCase();

  if (!NEON_ID.test(projectId)) reasons.push("DISPOSABLE_NEON_PROJECT_ID is not a Neon project id.");
  if (!/^br-[a-z0-9-]+$/.test(branchId)) reasons.push("DISPOSABLE_NEON_BRANCH_ID is not a Neon branch id (br-...).");
  if (!/^ep-[a-z0-9-]+$/.test(endpointId) || endpointId.endsWith("-pooler")) {
    reasons.push("DISPOSABLE_NEON_ENDPOINT_ID is not a Neon endpoint id (ep-..., without -pooler).");
  }
  if (!/^ep-[a-z0-9-]+$/.test(productionEndpointId) || productionEndpointId.endsWith("-pooler")) {
    reasons.push("PRODUCTION_DATABASE_ENDPOINT is not a Neon endpoint id (ep-..., without -pooler).");
  }
  if (endpointId === productionEndpointId) {
    reasons.push("DISPOSABLE_NEON_ENDPOINT_ID is the production endpoint.");
  }
  const developmentEndpointId = env.PROTECTED_DEVELOPMENT_ENDPOINT.trim().toLowerCase();
  if (!/^ep-[a-z0-9-]+$/.test(developmentEndpointId) || developmentEndpointId.endsWith("-pooler")) {
    reasons.push("PROTECTED_DEVELOPMENT_ENDPOINT is not a Neon endpoint id (ep-..., without -pooler).");
  }
  if (endpointId === developmentEndpointId) {
    reasons.push("DISPOSABLE_NEON_ENDPOINT_ID is the protected development endpoint.");
  }

  const pooled = parseNeonUrl("DATABASE_URL", env.DATABASE_URL, reasons);
  const direct = parseNeonUrl("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED, reasons);
  const protectedEndpoints = [
    ["PRODUCTION_DATABASE_ENDPOINT", productionEndpointId],
    ["PROTECTED_DEVELOPMENT_ENDPOINT", developmentEndpointId],
  ] as const;

  if (pooled) {
    if (!pooled.firstLabel.endsWith("-pooler")) reasons.push("DATABASE_URL must use the pooled host (ep-...-pooler).");
    if (pooled.firstLabel.replace(/-pooler$/, "") !== endpointId) reasons.push("DATABASE_URL does not point at DISPOSABLE_NEON_ENDPOINT_ID.");
    for (const [name, id] of protectedEndpoints) if (pooled.firstLabel.replace(/-pooler$/, "") === id) reasons.push(`DATABASE_URL points at ${name}.`);
  }
  if (direct) {
    if (direct.firstLabel.endsWith("-pooler")) reasons.push("DATABASE_URL_UNPOOLED must use the direct host, not -pooler.");
    if (direct.firstLabel !== endpointId) reasons.push("DATABASE_URL_UNPOOLED does not point at DISPOSABLE_NEON_ENDPOINT_ID.");
    for (const [name, id] of protectedEndpoints) if (direct.firstLabel === id) reasons.push(`DATABASE_URL_UNPOOLED points at ${name}.`);
  }
  if (pooled && direct) {
    if (pooled.domain !== direct.domain) reasons.push("DATABASE_URL and DATABASE_URL_UNPOOLED are in different Neon regions.");
    if (pooled.database !== direct.database) reasons.push("DATABASE_URL and DATABASE_URL_UNPOOLED name different databases.");
    if (pooled.user !== direct.user) reasons.push("DATABASE_URL and DATABASE_URL_UNPOOLED use different roles.");
  }

  if (reasons.length || !pooled || !direct) return { ok: false, reasons };
  return {
    ok: true,
    value: { projectId, branchId, endpointId, productionEndpointId, developmentEndpointId, pooledHost: pooled.host, directHost: direct.host, database: pooled.database, user: pooled.user },
  };
}

/**
 * Operating-system variables a child process needs to start. Nothing else from
 * the parent shell is passed on, so a credential exported there cannot reach a
 * child, whatever its name.
 */
const INHERITED_SYSTEM_VARIABLES = new Set(
  [
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS",
    "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "COMMONPROGRAMFILES", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "LANG", "TERM",
  ].map((name) => name.toUpperCase()),
);

export function buildChildEnv(
  parent: Record<string, string | undefined>,
  values: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && INHERITED_SYSTEM_VARIABLES.has(name.toUpperCase())) env[name] = value;
  }
  return { ...env, ...values };
}

/** Names a child may receive from the parent shell. Exposed for tests. */
export function isInheritedSystemVariable(name: string): boolean {
  return INHERITED_SYSTEM_VARIABLES.has(name.toUpperCase());
}

/**
 * The checkout must hold no private environment file, because Next.js, Prisma,
 * and the npm verify scripts all load `.env*` files on their own. The disposable
 * file itself must live outside the checkout.
 */
export function assessCheckout(checkoutDir: string, envFilePath: string, entries: readonly string[] = readdirSync(checkoutDir)): Checked<null> {
  const reasons: string[] = [];
  const privateFiles = entries.filter((name) => /^\.env/i.test(name) && name.toLowerCase() !== ".env.example");
  if (privateFiles.length) reasons.push(`The checkout holds private environment files (${privateFiles.join(", ")}); use a clean checkout.`);
  const inside = relative(resolve(checkoutDir), resolve(envFilePath));
  if (!inside.startsWith("..") && !isAbsolute(inside)) reasons.push("The disposable environment file must live outside the checkout.");
  return reasons.length ? { ok: false, reasons } : { ok: true, value: null };
}

/** The marker table that proves a database was prepared by this harness. */
export const MARKER_TABLE = "integration_disposable_marker";

export type SchemaObservation = {
  database: string;
  user: string;
  tables: readonly string[];
  marker: ReadonlyArray<{ project_id: string; branch_id: string; endpoint_id: string }> | null;
};

export type DatabaseState = "empty" | "marked";

/**
 * Decides from what a read-only connection observed whether the database is
 * this run's disposable one: empty and unmarked (never used), or carrying a
 * marker for exactly this project, branch, and endpoint. A database with tables
 * but no matching marker is refused, which is what a production database is.
 */
export function assessObservedDatabase(target: DisposableTarget, observed: SchemaObservation): Checked<DatabaseState> {
  const reasons: string[] = [];
  if (observed.database !== target.database) reasons.push("The connected database is not the one named in the connection URL.");
  if (observed.user !== target.user) reasons.push("The connected role is not the one named in the connection URL.");
  if (reasons.length) return { ok: false, reasons };

  if (observed.tables.length === 0) return { ok: true, value: "empty" };
  if (!observed.tables.includes(MARKER_TABLE) || !observed.marker) {
    return { ok: false, reasons: ["The database has tables but no disposable marker. It may not be a disposable database; refusing."] };
  }
  if (observed.marker.length !== 1) return { ok: false, reasons: ["The disposable marker must hold exactly one row."] };
  const [row] = observed.marker as [{ project_id: string; branch_id: string; endpoint_id: string }];
  if (row.project_id !== target.projectId || row.branch_id !== target.branchId || row.endpoint_id !== target.endpointId) {
    return { ok: false, reasons: ["The disposable marker belongs to a different project, branch, or endpoint."] };
  }
  return { ok: true, value: "marked" };
}

/** The guard's own variables for `scripts/lib/require-non-production-database`. */
export function guardVariables(target: DisposableTarget): Record<string, string> {
  return {
    DEV_DATABASE_ENDPOINT: target.endpointId,
    PRODUCTION_DATABASE_ENDPOINT: target.productionEndpointId,
    NEON_BRANCH: `integration-${target.branchId}`,
  };
}
