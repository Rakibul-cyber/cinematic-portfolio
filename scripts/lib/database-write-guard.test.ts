import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  ALLOW_PRODUCTION_FLAG,
  assessTarget,
  decide,
  enforceNonProduction,
  enforceWithProductionConfirmation,
  type GuardEnv,
  type GuardIo,
  targetIdentity,
} from "./database-write-guard";
import { runGuardedPrisma } from "./guarded-prisma";

/**
 * Coverage for the local database write guard. Every URL here is synthetic and
 * nothing connects: the Prisma CLI is a recorded mock, and the child-process
 * checks run the real scripts with a scrubbed environment (never `.env.local`)
 * and a probe that reports any socket connection attempt.
 */

const SECRET = "SyntheticPassw0rd-do-not-print";
const USER = "synthetic_owner";
const url = (endpoint: string, pooled = true) =>
  `postgresql://${USER}:${SECRET}@${endpoint}${pooled ? "-pooler" : ""}.eu-central-1.aws.neon.tech/neondb?sslmode=require`;

const DEV = "ep-synthetic-dev-111111";
const PROD = "ep-synthetic-prod-999999";

const devEnv = (overrides: GuardEnv = {}): GuardEnv => ({
  NEON_BRANCH: "development",
  DATABASE_URL: url(DEV),
  DATABASE_URL_UNPOOLED: url(DEV, false),
  DEV_DATABASE_ENDPOINT: DEV,
  PRODUCTION_DATABASE_ENDPOINT: PROD,
  ...overrides,
});
const prodEnv = (overrides: GuardEnv = {}): GuardEnv => ({
  NEON_BRANCH: "production",
  DATABASE_URL: url(PROD),
  DATABASE_URL_UNPOOLED: url(PROD, false),
  DEV_DATABASE_ENDPOINT: DEV,
  PRODUCTION_DATABASE_ENDPOINT: PROD,
  ...overrides,
});

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

function fakeIo(options: { interactive?: boolean; answer?: string } = {}) {
  const errors: string[] = [];
  const logs: string[] = [];
  const asked: string[] = [];
  const io: GuardIo = {
    exit: (code) => { throw new Exit(code); },
    error: (message) => { errors.push(message); },
    log: (message) => { logs.push(message); },
    interactive: options.interactive ?? false,
    ask: async (prompt) => { asked.push(prompt); return options.answer ?? ""; },
  };
  return { io, errors, logs, asked, output: () => [...errors, ...logs, ...asked].join("\n") };
}

const reasonsFor = (env: GuardEnv, operation = "verify-cms-flow", argv: string[] = []) => {
  const decision = decide({ operation, env, argv });
  assert.equal(decision.action, "refuse");
  return decision.action === "refuse" ? decision.reasons.join(" ") : "";
};

const assertNoSecrets = (text: string) => {
  for (const fragment of [SECRET, USER, "neon.tech", "postgresql://", DEV, PROD]) {
    assert.ok(!text.includes(fragment), `output must not contain ${fragment}`);
  }
};

describe("target identity", () => {
  it("uses the Neon endpoint id, shared by pooled and direct hosts", () => {
    assert.deepEqual(targetIdentity("DATABASE_URL", url(DEV)), { ok: true, identity: DEV });
    assert.deepEqual(targetIdentity("DATABASE_URL", url(DEV, false)), { ok: true, identity: DEV });
  });

  it("uses the host name for a non-Neon database", () => {
    assert.deepEqual(targetIdentity("DATABASE_URL", "postgresql://u:p@localhost:5432/dev"), { ok: true, identity: "localhost" });
  });

  it("refuses missing, malformed, non-PostgreSQL and redirectable URLs without echoing them", () => {
    for (const value of [undefined, "", "not a url", `mysql://${USER}:${SECRET}@host/db`, `${url(DEV)}&host=elsewhere`, `${url(DEV)}&options=endpoint%3D${PROD}`, `postgresql://${USER}:${SECRET}@x-pooler.eu.aws.neon.tech/db`]) {
      const result = targetIdentity("DATABASE_URL", value);
      assert.equal(result.ok, false);
      if (!result.ok) assertNoSecrets(result.reason);
    }
  });
});

describe("target assessment and decisions", () => {
  it("1. refuses a missing NEON_BRANCH", () => {
    assert.match(reasonsFor(devEnv({ NEON_BRANCH: undefined })), /NEON_BRANCH is not set/);
    assert.match(reasonsFor(devEnv({ NEON_BRANCH: "  " })), /NEON_BRANCH is not set/);
  });

  it("2. refuses a production branch label even when the endpoint is declared as development", () => {
    assert.match(reasonsFor(devEnv({ NEON_BRANCH: "production" })), /production branch label/);
    assert.match(reasonsFor(devEnv({ NEON_BRANCH: "main" })), /production branch label/);
  });

  it("3. treats the production label case-insensitively", () => {
    for (const label of ["Production", "PRODUCTION", " production ", "Main", "PROD"]) {
      assert.match(reasonsFor(devEnv({ NEON_BRANCH: label })), /production branch label/, label);
    }
  });

  it("4. allows the approved non-production target", () => {
    assert.deepEqual(assessTarget(devEnv()), { kind: "approved-non-production", identity: DEV });
    assert.deepEqual(decide({ operation: "verify-cms-flow", env: devEnv(), argv: [] }), { action: "proceed" });
    assert.deepEqual(decide({ operation: "verify-cms-flow", env: devEnv({ DATABASE_URL_UNPOOLED: undefined, PRODUCTION_DATABASE_ENDPOINT: undefined }), argv: [] }), { action: "proceed" });
    assert.deepEqual(decide({ operation: "db:migrate", env: devEnv({ DEV_DATABASE_ENDPOINT: DEV.toUpperCase() }), argv: [] }), { action: "proceed" });
  });

  it("5. refuses a branch label that does not match the connection", () => {
    // The label says development, but the URLs reach the production endpoint.
    assert.match(reasonsFor(prodEnv({ NEON_BRANCH: "development" })), /NEON_BRANCH names a non-production branch/);
    // The label says development, but the URLs reach an undeclared database.
    assert.match(reasonsFor(devEnv({ DATABASE_URL: url("ep-synthetic-other-555555"), DATABASE_URL_UNPOOLED: undefined })), /do not point at DEV_DATABASE_ENDPOINT/);
    // Pooled and direct URLs disagree.
    assert.match(reasonsFor(devEnv({ DATABASE_URL_UNPOOLED: url(PROD, false) })), /point at different databases/);
  });

  it("6. refuses a missing or ambiguous target identity", () => {
    assert.match(reasonsFor(devEnv({ DEV_DATABASE_ENDPOINT: undefined })), /DEV_DATABASE_ENDPOINT is not set/);
    assert.match(reasonsFor(devEnv({ DATABASE_URL: undefined })), /DATABASE_URL is not set/);
    assert.match(reasonsFor(devEnv({ DATABASE_URL_UNPOOLED: "" })), /DATABASE_URL_UNPOOLED is not set/);
    assert.match(reasonsFor(devEnv({ PRODUCTION_DATABASE_ENDPOINT: DEV })), /name the same database/);
    assert.match(reasonsFor(devEnv({ DATABASE_URL: `${url(DEV)}&host=127.0.0.1` })), /ambiguous/);
  });

  it("9. rejects --allow-production for ordinary scripts and migrate dev, whatever the target", () => {
    for (const operation of ["verify-cms-flow", "verify-public-flow", "db:migrate", "db:studio"]) {
      for (const env of [devEnv(), prodEnv()]) {
        assert.match(reasonsFor(env, operation, [ALLOW_PRODUCTION_FLAG]), /is not accepted by/);
      }
      assert.match(reasonsFor(prodEnv(), operation), /never runs against production/);
    }
  });

  it("10. grants production only to bootstrap and migrate deploy, and only with the flag", () => {
    for (const operation of ["admin:bootstrap", "db:migrate:deploy"]) {
      assert.match(reasonsFor(prodEnv(), operation), /requires --allow-production/);
      assert.deepEqual(decide({ operation, env: prodEnv(), argv: [ALLOW_PRODUCTION_FLAG] }), { action: "confirm-production", identity: PROD, branchLabel: "production" });
      // A label alone never makes a target production: undeclared endpoints are refused.
      assert.match(reasonsFor(prodEnv({ PRODUCTION_DATABASE_ENDPOINT: undefined }), operation, [ALLOW_PRODUCTION_FLAG]), /production branch label|DEV_DATABASE_ENDPOINT/);
      // The flag against the approved development target is contradictory.
      assert.match(reasonsFor(devEnv(), operation, [ALLOW_PRODUCTION_FLAG]), /Remove the flag/);
      assert.deepEqual(decide({ operation, env: devEnv(), argv: [] }), { action: "proceed" });
    }
  });
});

describe("enforcement", () => {
  it("exits non-zero with a refusal that names variables, never values", () => {
    const { io, errors } = fakeIo();
    assert.throws(() => enforceNonProduction({ operation: "verify-cms-flow", env: prodEnv(), argv: [] }, io), (e) => e instanceof Exit && e.code === 1);
    assert.match(errors.join("\n"), /Refusing to run verify-cms-flow/);
    assertNoSecrets(errors.join("\n"));
  });

  it("12. never prints credentials, hosts, or endpoint ids in any refusal", async () => {
    const cases: Array<[string, GuardEnv, string[]]> = [
      ["verify-cms-flow", prodEnv(), []],
      ["verify-cms-flow", devEnv({ NEON_BRANCH: undefined }), []],
      ["verify-cms-flow", devEnv({ DATABASE_URL: "postgresql://" + USER + ":" + SECRET + "@[bad" }), []],
      ["db:migrate", devEnv({ DATABASE_URL_UNPOOLED: url(PROD, false) }), [ALLOW_PRODUCTION_FLAG]],
      ["db:migrate:deploy", prodEnv(), []],
    ];
    for (const [operation, env, argv] of cases) {
      const { io, output } = fakeIo();
      await assert.rejects(enforceWithProductionConfirmation({ operation, env, argv }, io), Exit);
      assertNoSecrets(output());
    }
  });

  it("requires an interactive terminal and the exact endpoint id for production", async () => {
    const request = { operation: "db:migrate:deploy", env: prodEnv(), argv: [ALLOW_PRODUCTION_FLAG] };
    const headless = fakeIo({ interactive: false, answer: PROD });
    await assert.rejects(enforceWithProductionConfirmation(request, headless.io), Exit);
    assert.equal(headless.asked.length, 0);

    const wrong = fakeIo({ interactive: true, answer: "yes" });
    await assert.rejects(enforceWithProductionConfirmation(request, wrong.io), Exit);
    assert.match(wrong.errors.join("\n"), /did not match/);

    const confirmed = fakeIo({ interactive: true, answer: ` ${PROD.toUpperCase()} ` });
    await enforceWithProductionConfirmation(request, confirmed.io);
    assert.ok(!confirmed.output().includes(SECRET));
  });
});

describe("guarded Prisma commands", () => {
  const run = async (argv: string[], env: GuardEnv, options: { interactive?: boolean; answer?: string } = {}) => {
    const calls: Array<{ args: string[] }> = [];
    const { io, output } = fakeIo(options);
    let code: number | "exit";
    try {
      code = await runGuardedPrisma(argv, {
        env,
        io,
        loadEnvFiles: () => {},
        spawn: async (_cli, args) => { calls.push({ args }); return 0; },
        cwd: resolve("."),
      });
    } catch (error) {
      if (!(error instanceof Exit)) throw error;
      code = "exit";
    }
    return { code, calls, output: output() };
  };

  it("8 and 11. refuses migrate dev against production and never spawns Prisma", async () => {
    for (const argv of [["migrate-dev"], ["migrate-dev", ALLOW_PRODUCTION_FLAG], ["studio"], ["migrate-deploy"]]) {
      const result = await run(argv, prodEnv());
      assert.equal(result.code, "exit", argv.join(" "));
      assert.equal(result.calls.length, 0, argv.join(" "));
      assertNoSecrets(result.output);
    }
  });

  it("refuses an unknown command without spawning", async () => {
    const result = await run(["migrate-reset"], devEnv());
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
  });

  it("loads env files before deciding, so the guard judges the CLI's real target", async () => {
    const env: GuardEnv = {};
    const calls: string[][] = [];
    await assert.rejects(runGuardedPrisma(["migrate-dev"], {
      env, io: fakeIo().io, cwd: resolve("."),
      loadEnvFiles: (target) => Object.assign(target, prodEnv()),
      spawn: async (_cli, args) => { calls.push(args); return 0; },
    }), Exit);
    assert.equal(calls.length, 0);
  });

  it("passes approved non-production commands through to Prisma unchanged", async () => {
    const result = await run(["migrate-dev", "--name", "add_thing"], devEnv());
    assert.equal(result.code, 0);
    assert.deepEqual(result.calls, [{ args: ["migrate", "dev", "--name", "add_thing"] }]);
  });

  it("runs migrate deploy against production only after typed confirmation, without forwarding the flag", async () => {
    const result = await run(["migrate-deploy", ALLOW_PRODUCTION_FLAG], prodEnv(), { interactive: true, answer: PROD });
    assert.equal(result.code, 0);
    assert.deepEqual(result.calls, [{ args: ["migrate", "deploy"] }]);
  });
});

describe("7 and 11. every write-capable entry point is guarded before anything connects", () => {
  const ROOT = resolve(".");
  const GUARDED_SCRIPTS = ["cms", "crm", "email", "media", "public", "security"].map((name) => `scripts/verify-${name}-flow.ts`);
  const probeDir = mkdtempSync(join(tmpdir(), "db-guard-test-"));
  const probe = join(probeDir, "connect-probe.cjs");
  writeFileSync(probe, `"use strict";
const net = require("net");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  // Local IPC pipes (tsx talks to its own child over one) are not database connections.
  const isPipe = (first && typeof first === "object" && first.path) || (typeof first === "string" && !/^\\d+$/.test(first));
  if (isPipe) return original.apply(this, args);
  process.stderr.write("PROBE_SOCKET_CONNECT\\n");
  process.nextTick(() => this.destroy(new Error("probe: TCP connections are not allowed in this test")));
  return this;
};
`);
  after(() => rmSync(probeDir, { recursive: true, force: true }));

  /** A child environment built from scratch: OS essentials plus synthetic database settings. */
  const childEnv = (extra: GuardEnv) => {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "HOME"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key] as string;
    }
    for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;
    env.NODE_OPTIONS = `--require ${probe.replaceAll("\\", "/")}`;
    // Deliberately no NODE_ENV: the child gets nothing it does not need.
    return env as NodeJS.ProcessEnv;
  };
  const tsx = (args: string[], env: GuardEnv, cwd = ROOT) =>
    spawnSync(process.execPath, [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), ...args], { cwd, env: childEnv(env), encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });

  it("the connection probe detects a TCP attempt (positive control)", () => {
    const result = spawnSync(process.execPath, ["-e", "require('net').connect(1, '127.0.0.1').on('error', () => {})"], { env: childEnv({}), encoding: "utf8", timeout: 20_000 });
    assert.match(result.stderr, /PROBE_SOCKET_CONNECT/);
  });

  it("each write-capable verification script imports the guard first", () => {
    for (const file of GUARDED_SCRIPTS) {
      const firstImport = readFileSync(join(ROOT, file), "utf8").match(/^import .*$/m)?.[0];
      assert.equal(firstImport, 'import "./lib/require-non-production-database";', file);
    }
    const bootstrap = readFileSync(join(ROOT, "scripts/bootstrap-admin.ts"), "utf8");
    assert.ok(!/^import .*@\/server\//m.test(bootstrap), "bootstrap must not statically import server modules");
    assert.ok(bootstrap.indexOf("enforceWithProductionConfirmation(") < bootstrap.indexOf('await import("@/server/db/prisma")'));
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
    assert.equal(scripts["db:migrate"], "tsx scripts/prisma-guarded.ts migrate-dev");
    assert.equal(scripts["db:migrate:deploy"], "tsx scripts/prisma-guarded.ts migrate-deploy");
    assert.equal(scripts["db:studio"], "tsx scripts/prisma-guarded.ts studio");
  });

  for (const file of GUARDED_SCRIPTS) {
    it(`${file} exits before connecting when the target is production`, () => {
      const result = tsx(["--conditions=react-server", file], prodEnv());
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /\[db-guard\] Refusing to run/);
      assert.ok(!result.stderr.includes("PROBE_SOCKET_CONNECT"), "no socket may be opened");
      assertNoSecrets(result.stdout + result.stderr);
    });
  }

  it(`a verification script rejects ${ALLOW_PRODUCTION_FLAG}`, () => {
    const result = tsx(["--conditions=react-server", "scripts/verify-public-flow.ts", "--check", ALLOW_PRODUCTION_FLAG], devEnv());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not accepted by verify-public-flow/);
    assert.ok(!result.stderr.includes("PROBE_SOCKET_CONNECT"));
  });

  it("admin bootstrap refuses production without the flag, and without a terminal even with it", () => {
    const bootstrapEnv = { ...prodEnv(), ADMIN_BOOTSTRAP_PASSWORD: "synthetic-password-0000" };
    for (const extra of [[], [ALLOW_PRODUCTION_FLAG]]) {
      const result = tsx(["--conditions=react-server", "scripts/bootstrap-admin.ts", "--email", "owner@example.test", "--name", "Synthetic", ...extra], bootstrapEnv);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /\[db-guard\] Refusing to run admin:bootstrap/);
      assert.ok(!result.stderr.includes("PROBE_SOCKET_CONNECT"));
      assertNoSecrets(result.stdout + result.stderr);
    }
  });

  it("the Prisma wrapper refuses migrate dev, studio and headless migrate deploy before spawning", () => {
    // An empty working directory, so no real .env.local can be loaded.
    const cwd = mkdtempSync(join(tmpdir(), "db-guard-cwd-"));
    try {
      for (const argv of [["migrate-dev"], ["studio"], ["migrate-deploy", ALLOW_PRODUCTION_FLAG]]) {
        const result = tsx([join(ROOT, "scripts", "prisma-guarded.ts"), ...argv], prodEnv(), cwd);
        assert.equal(result.status, 1, `${argv.join(" ")}: ${result.stderr}`);
        assert.match(result.stderr, /\[db-guard\] Refusing to run/);
        assert.ok(!result.stderr.includes("PROBE_SOCKET_CONNECT"));
        assertNoSecrets(result.stdout + result.stderr);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
