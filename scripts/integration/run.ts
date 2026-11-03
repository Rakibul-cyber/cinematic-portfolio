/**
 * Disposable-Neon security integration harness.
 *
 * Run from a CLEAN checkout (no `.env.local` or any other `.env*` file but
 * `.env.example`), with a disposable environment file kept OUTSIDE the checkout:
 *
 *   npm run integration:preflight -- --env-file <path>
 *       Offline only. Validates the file, the target identity, the checkout,
 *       and Node.js 22. Opens no connection.
 *
 *   npm run integration:identity -- --env-file <path>
 *       Preflight, then one READ ONLY transaction on each of the pooled and the
 *       direct host. Writes nothing.
 *
 *   npm run integration:run -- --env-file <path> --allow-disposable-writes
 *       Preflight and identity, then: mark the (empty) database as disposable,
 *       apply migrations through the existing guarded Prisma runner, seed
 *       test-only accounts, build with Node.js 22, start three `next start`
 *       servers, and run the suites. Writes only to the verified disposable
 *       branch; delete the branch afterwards.
 *
 * The environment file may contain only the keys in `DISPOSABLE_ENV_KEYS`.
 * Every child process starts from a minimal allowlist of operating-system
 * variables plus generated, per-run values, so nothing exported in the parent
 * shell (a Resend key, a production URL) can reach it. Every child also loads
 * `network-guard.mjs`, which blocks every outbound connection except the
 * declared disposable Neon hosts and answers Turnstile locally.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assessCheckout,
  assessDisposableTarget,
  assessObservedDatabase,
  buildChildEnv,
  guardVariables,
  MARKER_TABLE,
  parseDisposableEnv,
  type DatabaseState,
  type DisposableEnv,
  type DisposableTarget,
  type SchemaObservation,
} from "./identity";

const CHECKOUT = process.cwd();
const GUARD = resolve(CHECKOUT, "scripts/integration/network-guard.mjs");
const TSX_CLI = resolve(CHECKOUT, "node_modules/tsx/dist/cli.mjs");
const NEXT_CLI = resolve(CHECKOUT, "node_modules/next/dist/bin/next");
const PORTS = { main: 3101, noSecret: 3102, dbDown: 3103 } as const;
const UNAVAILABLE_HOST = "db-unavailable.integration.invalid";
const UNAVAILABLE_URL = `postgresql://integration:integration-unavailable-password@${UNAVAILABLE_HOST}/neondb?sslmode=require`;

type Step = { name: string; ok: boolean; detail: string };

/** Child environments are built from an allowlist, so they never carry NODE_ENV; the project types require it. */
const processEnv = (env: Record<string, string>) => env as unknown as NodeJS.ProcessEnv;
const steps: Step[] = [];

/** Values that must never be printed, collected once the environment file is read. */
const redactions: string[] = [];
function redact(text: string): string {
  let out = text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgresql://[redacted]");
  for (const value of redactions) if (value) out = out.split(value).join("[redacted]");
  return out;
}

function refuse(reasons: readonly string[]): never {
  console.error("\n[integration] Refused. Nothing was changed.");
  for (const reason of reasons) console.error(`  - ${reason}`);
  process.exit(1);
}

function note(name: string, ok: boolean, detail = ""): void {
  steps.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// ---------------------------------------------------------------- preflight

type Preflight = { env: DisposableEnv; target: DisposableTarget; node: string };

function resolveNode22(): string {
  const explicit = flag("--node");
  const node = explicit ?? (() => {
    // One constant command string: nothing user-supplied reaches the shell.
    const result = spawnSync("npx -y node@22 -p process.execPath", {
      encoding: "utf8",
      shell: true,
      env: processEnv(buildChildEnv(process.env, {})),
    });
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() ?? "" : "";
  })();
  if (!node || !existsSync(node)) refuse(["Node.js 22 could not be located. Pass --node <path to a Node.js 22 binary>."]);
  const version = spawnSync(node, ["-p", "process.versions.node"], { encoding: "utf8", env: processEnv(buildChildEnv(process.env, {})) }).stdout.trim();
  if (!version.startsWith("22.")) refuse([`The selected Node.js is ${version || "unknown"}, not 22.x.`]);
  return node;
}

function preflight(): Preflight {
  console.log("\n[integration] Preflight (offline)\n");
  const envFile = flag("--env-file");
  if (!envFile) refuse(["--env-file <path> is required."]);
  const envPath = resolve(envFile);
  if (!existsSync(envPath) || !statSync(envPath).isFile()) refuse(["The disposable environment file does not exist."]);

  const reasons: string[] = [];
  const packageJson = JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")) as { name?: string };
  if (packageJson.name !== "cinematic-portfolio") reasons.push("Run this from the root of a cinematic-portfolio checkout.");
  if (!existsSync(join(CHECKOUT, "src/generated/prisma"))) reasons.push("src/generated/prisma is missing; run `npx prisma generate` in the clean checkout first.");
  for (const path of [GUARD, TSX_CLI, NEXT_CLI]) if (!existsSync(path)) reasons.push(`${path} is missing.`);

  const checkout = assessCheckout(CHECKOUT, envPath);
  if (!checkout.ok) reasons.push(...checkout.reasons);
  const parsed = parseDisposableEnv(readFileSync(envPath, "utf8"));
  if (!parsed.ok) refuse([...reasons, ...parsed.reasons]);
  for (const url of [parsed.value.DATABASE_URL, parsed.value.DATABASE_URL_UNPOOLED]) {
    try {
      redactions.push(decodeURIComponent(new URL(url).password));
    } catch {
      // An unparseable URL is refused below; there is no password to protect.
    }
  }
  const target = assessDisposableTarget(parsed.value);
  if (!target.ok) refuse([...reasons, ...target.reasons]);
  if (reasons.length) refuse(reasons);

  const node = resolveNode22();
  const t = target.value;
  console.log(`  Project   ${t.projectId}`);
  console.log(`  Branch    ${t.branchId}`);
  console.log(`  Endpoint  ${t.endpointId} (pooled ${t.pooledHost}, direct ${t.directHost})`);
  console.log(`  Database  ${t.database} as ${t.user}`);
  console.log(`  Refuses   ${t.productionEndpointId} (declared production endpoint)`);
  console.log(`  Node.js   ${spawnSync(node, ["--version"], { encoding: "utf8", env: processEnv(buildChildEnv(process.env, {})) }).stdout.trim()}`);
  console.log("  Checkout  no private environment files");
  return { env: parsed.value, target: t, node };
}

// ----------------------------------------------------------------- database

let runDir = "";
let guardLoaded = false;

async function loadGuard(target: DisposableTarget): Promise<void> {
  if (guardLoaded) return;
  process.env.INTEGRATION_ALLOWED_HOSTS = `${target.pooledHost},${target.directHost}`;
  process.env.INTEGRATION_NETWORK_LOG = join(runDir, "network.log");
  await import(pathToFileURL(GUARD).href);
  guardLoaded = true;
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

async function withClient<T>(connectionString: string, run: (client: Queryable) => Promise<T>): Promise<T> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await run(client as unknown as Queryable);
  } finally {
    client.release();
    await pool.end();
  }
}

type Observation = SchemaObservation & { migrations: string[]; otherSchemaTables: number };

/** One READ ONLY transaction: the server itself rejects any write inside it. */
async function observe(connectionString: string): Promise<Observation> {
  return withClient(connectionString, async (client) => {
    await client.query("BEGIN TRANSACTION READ ONLY");
    try {
      const [mode] = (await client.query("SELECT current_setting('transaction_read_only') AS read_only")).rows as [{ read_only: string }];
      if (mode.read_only !== "on") throw new Error("The identity transaction is not read-only.");
      const [who] = (await client.query("SELECT current_database() AS database, current_user AS usr")).rows as [{ database: string; usr: string }];
      const [other] = (await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('public', 'pg_catalog', 'information_schema')")).rows as [{ count: number }];
      const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((row) => String(row.table_name));
      const marker = tables.includes(MARKER_TABLE)
        ? (await client.query(`SELECT project_id, branch_id, endpoint_id FROM public.${MARKER_TABLE}`)).rows.map((row) => ({
            project_id: String(row.project_id),
            branch_id: String(row.branch_id),
            endpoint_id: String(row.endpoint_id),
          }))
        : null;
      const migrations = tables.includes("_prisma_migrations")
        ? (await client.query('SELECT migration_name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1')).rows.map((row) => String(row.migration_name))
        : [];
      return { database: who.database, user: who.usr, tables, marker, migrations, otherSchemaTables: other.count };
    } finally {
      await client.query("COMMIT");
    }
  });
}

async function verifyIdentity({ env, target }: Preflight): Promise<{ state: DatabaseState; migrations: string[] }> {
  console.log("\n[integration] Identity (read-only)\n");
  await loadGuard(target);
  const results = [];
  for (const [name, url] of [["pooled", env.DATABASE_URL], ["direct", env.DATABASE_URL_UNPOOLED]] as const) {
    let observed: Observation;
    try {
      observed = await observe(url);
    } catch (error) {
      const detail = error instanceof Error ? redact(`${error.name}: ${error.message}`) : "error";
      refuse([`The ${name} host could not be read read-only (${detail}). Identity cannot be established.`]);
    }
    const assessed = assessObservedDatabase(target, observed);
    if (!assessed.ok) refuse(assessed.reasons.map((reason) => `${name}: ${reason}`));
    console.log(`  ${name.padEnd(6)}  ${observed.database} as ${observed.user}, read-only transaction: ${assessed.value}, ${observed.tables.length} public tables, ${observed.otherSchemaTables} tables in other schemas, ${observed.migrations.length} migrations`);
    results.push({ state: assessed.value, migrations: observed.migrations, tables: observed.tables.join(",") });
  }
  const [pooled, direct] = results as [(typeof results)[0], (typeof results)[0]];
  if (pooled.state !== direct.state || pooled.tables !== direct.tables) refuse(["The pooled and direct hosts disagree about the database; refusing."]);

  // Which hosts this process actually reached, from the network guard's log.
  const network = readFileSync(join(runDir, "network.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; host?: string; pid: number })
    .filter((entry) => entry.pid === process.pid && entry.kind !== "guard-installed");
  const declared = new Set([target.pooledHost, target.directHost]);
  const contacted = [...new Set(network.filter((entry) => entry.kind.startsWith("allowed-")).map((entry) => entry.host ?? ""))];
  const blocked = network.filter((entry) => entry.kind.startsWith("blocked-"));
  if (blocked.length || contacted.some((host) => !declared.has(host)) || contacted.length === 0) {
    refuse([`Connections were not confined to the declared hosts (contacted: ${contacted.join(", ") || "none"}; blocked: ${blocked.length}).`]);
  }
  console.log(`  network  contacted only ${contacted.join(", ")}; nothing else attempted`);

  console.log("\n  Proven by these connections:");
  console.log("    - both hosts answer as the same database and role named in the URLs");
  console.log("    - both report the same tables, inside server-enforced read-only transactions");
  console.log(`    - the database is ${pooled.state === "empty" ? "empty (no table in the public schema)" : "carrying this run's disposable marker"}`);
  console.log("    - no host other than the two declared ones was contacted");
  console.log("  Taken from the hostnames (Neon routes each connection by its endpoint id):");
  console.log(`    - endpoint ${target.endpointId}, which is not the declared production endpoint ${target.productionEndpointId}`);
  console.log("  NOT proven by a database connection; confirm in the Neon Console:");
  console.log(`    - project ${target.projectId} is a separate disposable project`);
  console.log(`    - branch ${target.branchId} is that project's branch, and ${target.endpointId} is its read-write compute`);
  return { state: pooled.state, migrations: pooled.migrations };
}

async function markDisposable({ env, target }: Preflight): Promise<void> {
  await withClient(env.DATABASE_URL_UNPOOLED, async (client) => {
    await client.query("BEGIN");
    try {
      const [{ count }] = (await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'")).rows as [{ count: number }];
      if (count !== 0) throw new Error("The database is no longer empty.");
      await client.query(`CREATE TABLE public.${MARKER_TABLE} (project_id text NOT NULL, branch_id text NOT NULL, endpoint_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(`INSERT INTO public.${MARKER_TABLE} (project_id, branch_id, endpoint_id) VALUES ($1, $2, $3)`, [target.projectId, target.branchId, target.endpointId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

// ----------------------------------------------------------------- children

function databaseEnv(env: DisposableEnv): Record<string, string> {
  return { DATABASE_URL: env.DATABASE_URL, DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED };
}

function guardEnv(allowedHosts: string): Record<string, string> {
  return {
    NODE_OPTIONS: `--import ${pathToFileURL(GUARD).href}`,
    INTEGRATION_ALLOWED_HOSTS: allowedHosts,
    INTEGRATION_NETWORK_LOG: join(runDir, "network.log"),
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function exec(name: string, command: string, args: string[], env: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const log = createWriteStream(join(runDir, `${name}.log`));
    const child = spawn(command, args, { cwd: CHECKOUT, env: processEnv(env), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk: Buffer) => { output += chunk.toString(); log.write(chunk); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => done({ code: 1, output }));
    child.on("exit", (code) => { log.end(); done({ code: code ?? 1, output }); });
  });
}

const servers: Array<{ name: string; child: ChildProcess }> = [];

async function startServer(node: string, name: string, port: number, env: Record<string, string>): Promise<ChildProcess> {
  const base = `http://localhost:${port}`;
  const occupied = await fetch(`${base}/`, { signal: AbortSignal.timeout(1_000) }).then(() => true, () => false);
  if (occupied) throw new Error(`Port ${port} is already serving; refusing to test an unknown server.`);
  const log = createWriteStream(join(runDir, `server-${name}.log`));
  const child = spawn(node, [NEXT_CLI, "start", "-p", String(port)], { cwd: CHECKOUT, env: processEnv(env), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  servers.push({ name, child });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server ${name} exited during start.`);
    const up = await fetch(`${base}/admin/login`, { redirect: "manual", signal: AbortSignal.timeout(2_000) }).then((r) => r.status < 500, () => false);
    if (up) return child;
    await new Promise((wait) => setTimeout(wait, 500));
  }
  throw new Error(`Server ${name} did not start.`);
}

function stopServers(): void {
  for (const { child } of servers) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", env: processEnv(buildChildEnv(process.env, {})) });
    else child.kill("SIGTERM");
  }
}

function counts(output: string): { pass: number; fail: number } {
  const pick = (label: string) => Number(new RegExp(`^(?:ℹ|#) ${label} (\\d+)`, "m").exec(output)?.[1] ?? Number.NaN);
  return { pass: pick("pass"), fail: pick("fail") };
}

function suiteStep(name: string, output: string, code: number): { pass: number; fail: number } {
  const result = counts(output);
  note(name, code === 0 && result.fail === 0 && result.pass > 0, `${result.pass} passed, ${result.fail} failed`);
  if (code !== 0) console.log(output.split(/\r?\n/).filter((line) => /✖|not ok|Error|assert/i.test(line)).slice(0, 40).join("\n"));
  return result;
}

function walk(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path, pattern) : pattern.test(entry.name) ? [path] : [];
  });
}

// ---------------------------------------------------------------------- run

async function run(checked: Preflight): Promise<void> {
  if (!process.argv.includes("--allow-disposable-writes")) refuse(["integration:run writes to the disposable branch; pass --allow-disposable-writes to confirm."]);
  const { env, target, node } = checked;

  const identity = await verifyIdentity(checked);
  console.log("\n[integration] Preparing the disposable database\n");
  if (identity.state === "empty") {
    await markDisposable(checked);
    const again = await verifyIdentity(checked);
    if (again.state !== "marked") refuse(["The disposable marker could not be confirmed after creation."]);
    note("disposable marker created and re-verified", true);
  } else {
    note("disposable marker already present and matching", true);
  }

  const secrets = {
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    RATE_LIMIT_HMAC_SECRET: randomBytes(32).toString("base64url"),
  };
  const dbHosts = `${target.pooledHost},${target.directHost}`;
  const appEnv = (port: number) => ({
    ...databaseEnv(env),
    ...secrets,
    BETTER_AUTH_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${PORTS.main}`,
    TURNSTILE_SITE_KEY: "integration-dummy-site-key",
    TURNSTILE_SECRET_KEY: "integration-dummy-secret-key",
  });

  // Migrations go through the repository's own guarded runner, which applies its
  // own identity check to both URLs before Prisma starts.
  const migrate = await exec("migrate", node, [TSX_CLI, "scripts/prisma-guarded.ts", "migrate-deploy"], buildChildEnv(process.env, { ...databaseEnv(env), ...guardVariables(target) }));
  const expected = readdirSync(join(CHECKOUT, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const applied = (await verifyIdentity(checked)).migrations;
  note("migrations applied by the guarded runner", migrate.code === 0 && JSON.stringify(applied) === JSON.stringify(expected), `${applied.length}/${expected.length}`);
  if (migrate.code !== 0) refuse(["Migrations failed; see migrate.log in the run directory."]);

  // Test-only accounts, hashed by Better Auth's own default hasher.
  const { hashPassword } = await import("better-auth/crypto");
  const runTag = randomUUID().slice(0, 8);
  const roles = { super: "SUPER_ADMIN", admin: "ADMIN", editor: "EDITOR", accountLimit: "EDITOR", clientLimit: "EDITOR", concurrent: "EDITOR", separation: "EDITOR", noSecret: "SUPER_ADMIN" } as const;
  const users = Object.fromEntries(Object.entries(roles).map(([key, role]) => [key, { id: randomUUID(), email: `${key.toLowerCase()}-${runTag}@integration.invalid`, password: randomBytes(18).toString("base64url"), role }]));
  await withClient(env.DATABASE_URL_UNPOOLED, async (client) => {
    await client.query("BEGIN");
    for (const [key, user] of Object.entries(users)) {
      await client.query('INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4::"AdminRole", now(), now())', [user.id, `Integration ${key}`, user.email, user.role]);
      await client.query('INSERT INTO "account" (id, "accountId", "providerId", password, "userId", "createdAt", "updatedAt") VALUES ($1, $2, \'credential\', $3, $2, now(), now())', [randomUUID(), user.id, await hashPassword(user.password)]);
    }
    await client.query("COMMIT");
  });
  note("test-only accounts seeded", true, `${Object.keys(users).length} accounts @integration.invalid`);

  console.log("\n[integration] Production build (Node.js 22)\n");
  const build = await exec("build", node, [NEXT_CLI, "build"], buildChildEnv(process.env, { ...appEnv(PORTS.main), ...guardEnv(dbHosts) }));
  note("next build, including static page generation", build.code === 0, build.code === 0 ? "" : "see build.log");
  if (build.code !== 0) refuse(["The production build failed; see build.log."]);

  const serverFiles = walk(join(CHECKOUT, ".next/server"), /\.(js|mjs|cjs)$/).map((file) => readFileSync(file, "utf8"));
  note("server bundle has no Turnstile bypass", serverFiles.some((text) => text.includes("turnstile/v0/siteverify")) && !serverFiles.some((text) => /bypassed:!0/.test(text)));
  note("server bundle has no fallback rate-limit key", serverFiles.some((text) => text.includes("RATE_LIMIT_HMAC_SECRET")) && !serverFiles.some((text) => text.includes("development-only-rate-limit-secret")));
  const clientText = walk(join(CHECKOUT, ".next/static"), /\.(js|css|html|json)$/).map((file) => readFileSync(file, "utf8")).join("\n");
  const dbPassword = decodeURIComponent(new URL(env.DATABASE_URL).password);
  const leaked = [["BETTER_AUTH_SECRET", secrets.BETTER_AUTH_SECRET], ["RATE_LIMIT_HMAC_SECRET", secrets.RATE_LIMIT_HMAC_SECRET], ["TURNSTILE_SECRET_KEY", "integration-dummy-secret-key"], ["database password", dbPassword], ["database host", target.pooledHost], ["database host", target.directHost]]
    .filter(([, value]) => value && clientText.includes(value!)).map(([label]) => label);
  note("client bundles hold no secret or database detail", leaked.length === 0, leaked.join(", "));

  console.log("\n[integration] Servers\n");
  const withoutLimiterSecret: Record<string, string> = Object.fromEntries(Object.entries(appEnv(PORTS.noSecret)).filter(([name]) => name !== "RATE_LIMIT_HMAC_SECRET"));
  const main = await startServer(node, "main", PORTS.main, buildChildEnv(process.env, { ...appEnv(PORTS.main), ...guardEnv(dbHosts) }));
  const noSecret = await startServer(node, "no-secret", PORTS.noSecret, buildChildEnv(process.env, { ...withoutLimiterSecret, ...guardEnv(dbHosts) }));
  const dbDown = await startServer(node, "db-down", PORTS.dbDown, buildChildEnv(process.env, { ...appEnv(PORTS.dbDown), DATABASE_URL: UNAVAILABLE_URL, DATABASE_URL_UNPOOLED: UNAVAILABLE_URL, ...guardEnv("") }));
  const guarded = new Set(readFileSync(join(runDir, "network.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; pid: number }).filter((entry) => entry.kind === "guard-installed").map((entry) => entry.pid));
  note("every server loaded the network guard", [main, noSecret, dbDown].every((child) => guarded.has(child.pid!)));

  console.log("\n[integration] Suites\n");
  const suiteEnv = (extra: Record<string, string>, hosts = dbHosts) => buildChildEnv(process.env, { ...appEnv(PORTS.main), ...guardVariables(target), ...guardEnv(hosts), ...extra });

  const auth = await exec("auth-verify", node, ["scripts/verify-auth-flow.mjs"], suiteEnv({ AUTH_VERIFY_BASE_URL: `http://localhost:${PORTS.main}`, ADMIN_TEST_EMAIL: users.super!.email, ADMIN_TEST_PASSWORD: users.super!.password }));
  const authCounts = /(\d+) passed, (\d+) failed/.exec(auth.output);
  note("npm run auth:verify (existing end-to-end flow)", auth.code === 0, authCounts ? `${authCounts[1]} passed, ${authCounts[2]} failed` : "no summary");

  const http = await exec("suite-http", node, [TSX_CLI, "--conditions=react-server", "--test", "--test-reporter=spec", "scripts/integration/http.integration.ts"], suiteEnv({
    INTEGRATION_BASE_MAIN: `http://localhost:${PORTS.main}`,
    INTEGRATION_BASE_NO_SECRET: `http://localhost:${PORTS.noSecret}`,
    INTEGRATION_BASE_DB_DOWN: `http://localhost:${PORTS.dbDown}`,
    INTEGRATION_USERS: JSON.stringify(users),
  }));
  suiteStep("authentication and inquiry HTTP suite", http.output, http.code);

  const inquiry = await exec("suite-inquiry", node, [TSX_CLI, "--conditions=react-server", "--test", "--test-reporter=spec", "scripts/integration/inquiry.integration.ts"], suiteEnv({}));
  suiteStep("inquiry workflow suite (real services)", inquiry.output, inquiry.code);

  const security = await exec("security-verify", node, [TSX_CLI, "--conditions=react-server", "scripts/verify-security-flow.ts"], suiteEnv({}));
  note("npm run security:verify (existing live flow)", security.code === 0 && /Live security verification passed/.test(security.output));

  const downEnv = buildChildEnv(process.env, {
    ...appEnv(PORTS.main), DATABASE_URL: UNAVAILABLE_URL, DATABASE_URL_UNPOOLED: UNAVAILABLE_URL,
    DEV_DATABASE_ENDPOINT: UNAVAILABLE_HOST, PRODUCTION_DATABASE_ENDPOINT: target.productionEndpointId, NEON_BRANCH: "integration-unavailable", ...guardEnv(""),
  });
  const down = await exec("suite-db-down", node, [TSX_CLI, "--conditions=react-server", "--test", "--test-reporter=spec", "scripts/integration/inquiry-db-down.integration.ts"], downEnv);
  suiteStep("inquiry workflow with the database down", down.output, down.code);

  const unit = await exec("npm-test", node, [TSX_CLI, "--conditions=react-server", "--test", "--test-reporter=spec", "src/**/*.test.ts", "scripts/**/*.test.ts"], buildChildEnv(process.env, { NEXT_TELEMETRY_DISABLED: "1" }));
  const unitCounts = counts(unit.output);
  const skipped = Number(/^(?:ℹ|#) skipped (\d+)/m.exec(unit.output)?.[1] ?? Number.NaN);
  note("unit suites against the fresh build (bundle checks no longer skip)", unit.code === 0 && skipped === 0, `${unitCounts.pass} passed, ${unitCounts.fail} failed, ${skipped} skipped`);

  stopServers();
  await new Promise((wait) => setTimeout(wait, 1_000));

  // What left each process.
  const network = readFileSync(join(runDir, "network.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; pid: number; host?: string });
  const downPids = new Set([dbDown.pid]);
  // The Neon driver retries a refused WebSocket as an HTTP upgrade, so the
  // unreachable host appears as a blocked fetch too. Nothing else may.
  const strayFetches = network.filter((entry) => entry.kind === "blocked-fetch" && entry.host !== UNAVAILABLE_HOST);
  note("no blocked outbound fetch (no Resend, Sentry, or other service)", strayFetches.length === 0, strayFetches.map((entry) => entry.host).join(", "));
  note("only the unreachable host was refused a WebSocket", network.filter((entry) => entry.kind === "blocked-websocket").every((entry) => entry.host === UNAVAILABLE_HOST));
  note("the built server never consulted Turnstile (closed gate)", !network.some((entry) => entry.kind === "turnstile" && (entry.pid === main.pid || downPids.has(entry.pid))));
  note("Turnstile answered only by the local mock", network.filter((entry) => entry.kind === "turnstile").length > 0);

  // What the servers logged.
  const logs = Object.fromEntries(["main", "no-secret", "db-down"].map((name) => [name, readFileSync(join(runDir, `server-${name}.log`), "utf8")]));
  const allLogs = Object.values(logs).join("\n");
  const sensitive = [
    ...Object.values(users).flatMap((user) => [user.email, user.password]),
    secrets.BETTER_AUTH_SECRET, secrets.RATE_LIMIT_HMAC_SECRET, dbPassword, "integration-unavailable-password", "postgresql://", "postgres://",
  ].filter((value) => allLogs.includes(value));
  const addresses = /\b(198\.51\.100|203\.0\.\d+|192\.0\.2)\.\d+\b/.test(allLogs);
  note("server logs hold no credential, email, secret, connection string, or address", sensitive.length === 0 && !addresses, sensitive.length ? `${sensitive.length} sensitive value(s)` : addresses ? "client address logged" : "");
  note("server logs record the expected categories only", /"category":"rate_limited"/.test(logs.main!) && /"category":"limit_unconfigured"/.test(logs["no-secret"]!) && /"category":"limit_storage_failed"/.test(logs["db-down"]!));
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !["preflight", "identity", "run"].includes(command)) {
    refuse(["Use one of: preflight, identity, run. See the header of scripts/integration/run.ts."]);
  }
  runDir = mkdtempSync(join(tmpdir(), "munir-integration-"));
  const checked = preflight();
  if (command === "preflight") {
    console.log("\n  Preflight passed. No connection was opened.\n");
    return;
  }
  if (command === "identity") {
    const identity = await verifyIdentity(checked);
    console.log(`\n  Identity established: ${identity.state}. Nothing was written.\n`);
    return;
  }
  console.log(`\n  Run directory (logs, outside the checkout): ${runDir}`);
  try {
    await run(checked);
  } finally {
    stopServers();
    writeFileSync(join(runDir, "summary.json"), JSON.stringify(steps, null, 2));
  }
  const failed = steps.filter((step) => !step.ok);
  console.log(`\n[integration] ${steps.length - failed.length} passed, ${failed.length} failed. Logs: ${runDir}`);
  console.log("  Delete the disposable branch when you are done; it holds test-only data.\n");
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  stopServers();
  console.error(`\n[integration] Stopped: ${redact(error instanceof Error ? `${error.name}: ${error.message}` : "unexpected error")}`);
  process.exitCode = 1;
});
