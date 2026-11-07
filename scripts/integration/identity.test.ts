import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import {
  assessCheckout,
  assessDisposableTarget,
  assessObservedDatabase,
  buildChildEnv,
  DISPOSABLE_ENV_KEYS,
  guardVariables,
  MARKER_TABLE,
  parseDisposableEnv,
  type DisposableEnv,
  type DisposableTarget,
} from "./identity";

/**
 * Offline checks for the disposable-Neon harness. Every host here is fictional
 * and nothing opens a connection: the network-guard tests only exercise
 * requests the guard refuses or answers itself.
 */

const ENDPOINT = "ep-quiet-sky-a1b2c3d4";
const PRODUCTION = "ep-bold-sea-e5f6a7b8";
const DEVELOPMENT = "ep-warm-dune-c9d0e1f2";
const REGION = "eu-central-1.aws.neon.tech";
const valid: DisposableEnv = {
  DATABASE_URL: `postgresql://itest_owner:fake-password@${ENDPOINT}-pooler.${REGION}/neondb?sslmode=require`,
  DATABASE_URL_UNPOOLED: `postgresql://itest_owner:fake-password@${ENDPOINT}.${REGION}/neondb?sslmode=require`,
  DISPOSABLE_NEON_PROJECT_ID: "fancy-hill-12345678",
  DISPOSABLE_NEON_BRANCH_ID: "br-young-moon-a1b2c3d4",
  DISPOSABLE_NEON_ENDPOINT_ID: ENDPOINT,
  PRODUCTION_DATABASE_ENDPOINT: PRODUCTION,
  PROTECTED_DEVELOPMENT_ENDPOINT: DEVELOPMENT,
};
const file = (env: Partial<DisposableEnv> & Record<string, string>) => Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n");
const reasons = (env: DisposableEnv) => {
  const result = assessDisposableTarget(env);
  return result.ok ? [] : result.reasons;
};

describe("the disposable environment file", () => {
  it("accepts exactly the allowed keys, with comments and quotes", () => {
    const parsed = parseDisposableEnv(`# disposable\n${file({ ...valid, DATABASE_URL: `"${valid.DATABASE_URL}"` })}\n`);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.DATABASE_URL, valid.DATABASE_URL);
  });

  it("refuses any other key, so no service secret can be smuggled in", () => {
    for (const extra of ["RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "BETTER_AUTH_SECRET", "NODE_ENV", "DEV_DATABASE_ENDPOINT"]) {
      const parsed = parseDisposableEnv(file({ ...valid, [extra]: "x" }));
      assert.ok(!parsed.ok, extra);
      assert.ok(parsed.reasons.some((reason) => reason.startsWith(extra)));
    }
  });

  it("refuses duplicates, missing keys, and malformed lines", () => {
    assert.ok(!parseDisposableEnv(`${file(valid)}\nDATABASE_URL=${valid.DATABASE_URL}`).ok);
    for (const key of DISPOSABLE_ENV_KEYS) {
      const rest = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
      assert.ok(!parseDisposableEnv(file(rest)).ok, key);
    }
    assert.ok(!parseDisposableEnv(`${file(valid)}\nnot a line`).ok);
  });

  it("never repeats a value in a refusal", () => {
    const parsed = parseDisposableEnv(file({ ...valid, RESEND_API_KEY: "re_secret_value" }));
    assert.ok(!parsed.ok);
    assert.ok(!JSON.stringify(parsed.reasons).includes("re_secret_value"));
    assert.ok(!JSON.stringify(reasons({ ...valid, DATABASE_URL: "postgresql://u:secret-pw@db.example.com/x" })).includes("secret-pw"));
  });
});

describe("the disposable target", () => {
  it("accepts matching pooled and direct hosts of the declared endpoint", () => {
    const result = assessDisposableTarget(valid);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.reasons));
    assert.equal(result.value.endpointId, ENDPOINT);
    assert.equal(result.value.pooledHost, `${ENDPOINT}-pooler.${REGION}`);
    assert.equal(result.value.database, "neondb");
  });

  it("refuses the production endpoint, however it is reached", () => {
    const productionUrls = {
      DATABASE_URL: valid.DATABASE_URL.replaceAll(ENDPOINT, PRODUCTION),
      DATABASE_URL_UNPOOLED: valid.DATABASE_URL_UNPOOLED.replaceAll(ENDPOINT, PRODUCTION),
    };
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_ENDPOINT_ID: PRODUCTION }).length);
    assert.ok(reasons({ ...valid, ...productionUrls }).some((reason) => /PRODUCTION_DATABASE_ENDPOINT/.test(reason)));
    assert.ok(reasons({ ...valid, ...productionUrls, DISPOSABLE_NEON_ENDPOINT_ID: PRODUCTION }).length);
    assert.ok(reasons({ ...valid, DATABASE_URL_UNPOOLED: productionUrls.DATABASE_URL_UNPOOLED }).length, "one URL alone pointing at production");
  });

  it("refuses the protected development endpoint on its own, however it is reached", () => {
    const developmentUrls = {
      DATABASE_URL: valid.DATABASE_URL.replaceAll(ENDPOINT, DEVELOPMENT),
      DATABASE_URL_UNPOOLED: valid.DATABASE_URL_UNPOOLED.replaceAll(ENDPOINT, DEVELOPMENT),
    };
    // Production is declared and different, so only the development rule can catch these.
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_ENDPOINT_ID: DEVELOPMENT }).some((reason) => /protected development endpoint/.test(reason)));
    assert.ok(reasons({ ...valid, ...developmentUrls }).some((reason) => /DATABASE_URL points at PROTECTED_DEVELOPMENT_ENDPOINT/.test(reason)));
    assert.ok(reasons({ ...valid, ...developmentUrls }).some((reason) => /DATABASE_URL_UNPOOLED points at PROTECTED_DEVELOPMENT_ENDPOINT/.test(reason)));
    const all = reasons({ ...valid, ...developmentUrls, DISPOSABLE_NEON_ENDPOINT_ID: DEVELOPMENT });
    assert.ok(all.length && all.every((reason) => !/PRODUCTION_DATABASE_ENDPOINT|production endpoint/.test(reason)), "not caught by the production rule");
    assert.ok(reasons({ ...valid, DATABASE_URL_UNPOOLED: developmentUrls.DATABASE_URL_UNPOOLED }).length, "one URL alone pointing at development");
  });

  it("protects both endpoints at once when they differ, and still when they are the same", () => {
    for (const target of [PRODUCTION, DEVELOPMENT]) {
      const urls = { DATABASE_URL: valid.DATABASE_URL.replaceAll(ENDPOINT, target), DATABASE_URL_UNPOOLED: valid.DATABASE_URL_UNPOOLED.replaceAll(ENDPOINT, target) };
      assert.ok(reasons({ ...valid, ...urls, DISPOSABLE_NEON_ENDPOINT_ID: target }).length, target);
    }
    const shared = { ...valid, PRODUCTION_DATABASE_ENDPOINT: DEVELOPMENT };
    assert.ok(assessDisposableTarget(shared).ok, "a shared production/development endpoint is a valid declaration");
    assert.ok(reasons({ ...shared, DISPOSABLE_NEON_ENDPOINT_ID: DEVELOPMENT }).length);
  });

  it("requires the protected development endpoint and checks its form", () => {
    const { PROTECTED_DEVELOPMENT_ENDPOINT: _omitted, ...rest } = valid;
    void _omitted;
    const parsed = parseDisposableEnv(file(rest));
    assert.ok(!parsed.ok && parsed.reasons.some((reason) => reason.startsWith("PROTECTED_DEVELOPMENT_ENDPOINT")));
    assert.ok(reasons({ ...valid, PROTECTED_DEVELOPMENT_ENDPOINT: "development" }).length);
    assert.ok(reasons({ ...valid, PROTECTED_DEVELOPMENT_ENDPOINT: `${DEVELOPMENT}-pooler` }).length);
    const result = assessDisposableTarget(valid);
    assert.ok(result.ok);
    assert.equal(result.value.developmentEndpointId, DEVELOPMENT);
  });

  it("refuses URLs that do not both name the declared endpoint", () => {
    const other = "ep-other-tree-99999999";
    assert.ok(reasons({ ...valid, DATABASE_URL: valid.DATABASE_URL.replace(ENDPOINT, other) }).length);
    assert.ok(reasons({ ...valid, DATABASE_URL_UNPOOLED: valid.DATABASE_URL_UNPOOLED.replace(ENDPOINT, other) }).length);
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_ENDPOINT_ID: other }).length);
  });

  it("requires the pooled host for DATABASE_URL and the direct host for DATABASE_URL_UNPOOLED", () => {
    assert.ok(reasons({ ...valid, DATABASE_URL: valid.DATABASE_URL_UNPOOLED }).length);
    assert.ok(reasons({ ...valid, DATABASE_URL_UNPOOLED: valid.DATABASE_URL }).length);
  });

  it("refuses non-Neon, ambiguous, unencrypted, or mismatched URLs", () => {
    const variants = [
      valid.DATABASE_URL.replace(`.${REGION}`, ".example.com"),
      valid.DATABASE_URL.replace("postgresql:", "mysql:"),
      `${valid.DATABASE_URL}&host=other.example`,
      `${valid.DATABASE_URL}&options=endpoint%3Dep-x`,
      valid.DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
      valid.DATABASE_URL.replace("?sslmode=require", ""),
      valid.DATABASE_URL.replace(`${REGION}/`, `${REGION}:5432/`),
      valid.DATABASE_URL.replace("/neondb", "/otherdb"),
      valid.DATABASE_URL.replace("itest_owner", "other_owner"),
      valid.DATABASE_URL.replace(REGION, "us-east-2.aws.neon.tech"),
      valid.DATABASE_URL.replace(":fake-password", ""),
      "not a url",
    ];
    for (const DATABASE_URL of variants) assert.ok(reasons({ ...valid, DATABASE_URL }).length, DATABASE_URL);
  });

  it("refuses malformed identifiers", () => {
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_BRANCH_ID: "main" }).length);
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_ENDPOINT_ID: `${ENDPOINT}-pooler` }).length);
    assert.ok(reasons({ ...valid, PRODUCTION_DATABASE_ENDPOINT: "production" }).length);
    assert.ok(reasons({ ...valid, DISPOSABLE_NEON_PROJECT_ID: "Project With Spaces" }).length);
  });

  it("gives the repository guard matching, non-production variables", () => {
    const result = assessDisposableTarget(valid);
    assert.ok(result.ok);
    assert.deepEqual(guardVariables(result.value), { DEV_DATABASE_ENDPOINT: ENDPOINT, PRODUCTION_DATABASE_ENDPOINT: PRODUCTION, NEON_BRANCH: "integration-br-young-moon-a1b2c3d4" });
  });
});

describe("the observed database", () => {
  const target = (assessDisposableTarget(valid) as { ok: true; value: DisposableTarget }).value;
  const marker = [{ project_id: target.projectId, branch_id: target.branchId, endpoint_id: target.endpointId }];
  const base = { database: "neondb", user: "itest_owner" };

  it("accepts an empty database, or one carrying this branch's marker", () => {
    assert.deepEqual(assessObservedDatabase(target, { ...base, tables: [], marker: null }), { ok: true, value: "empty" });
    assert.deepEqual(assessObservedDatabase(target, { ...base, tables: [MARKER_TABLE, "user", "_prisma_migrations"], marker }), { ok: true, value: "marked" });
  });

  it("refuses a database with tables but no marker, as production would look", () => {
    assert.ok(!assessObservedDatabase(target, { ...base, tables: ["user", "session", "_prisma_migrations"], marker: null }).ok);
  });

  it("refuses another branch's marker, more than one marker row, or a different database or role", () => {
    assert.ok(!assessObservedDatabase(target, { ...base, tables: [MARKER_TABLE], marker: [{ ...marker[0]!, branch_id: "br-other" }] }).ok);
    assert.ok(!assessObservedDatabase(target, { ...base, tables: [MARKER_TABLE], marker: [...marker, ...marker] }).ok);
    assert.ok(!assessObservedDatabase(target, { ...base, tables: [MARKER_TABLE], marker: [] }).ok);
    assert.ok(!assessObservedDatabase(target, { ...base, database: "other", tables: [], marker: null }).ok);
    assert.ok(!assessObservedDatabase(target, { ...base, user: "other", tables: [], marker: null }).ok);
  });
});

describe("child environments and the checkout", () => {
  it("pass on only operating-system variables from the parent shell", () => {
    const parent = {
      Path: "C:\\bin", SystemRoot: "C:\\Windows", TEMP: "C:\\tmp", USERPROFILE: "C:\\u",
      DATABASE_URL: "postgresql://prod", DATABASE_URL_UNPOOLED: "postgresql://prod", RESEND_API_KEY: "re_x", TURNSTILE_SECRET_KEY: "t",
      BETTER_AUTH_SECRET: "b", RATE_LIMIT_HMAC_SECRET: "r", NODE_ENV: "development", NODE_OPTIONS: "--require evil", SENTRY_AUTH_TOKEN: "s",
      NEON_API_KEY: "n", AWS_SECRET_ACCESS_KEY: "a", npm_config_userconfig: "x", GITHUB_TOKEN: "g",
    };
    const env = buildChildEnv(parent, { DATABASE_URL: "postgresql://disposable" });
    assert.deepEqual(Object.keys(env).sort(), ["DATABASE_URL", "Path", "SystemRoot", "TEMP", "USERPROFILE"]);
    assert.equal(env.DATABASE_URL, "postgresql://disposable");
  });

  it("refuse a checkout holding private environment files, or an env file inside it", () => {
    const checkout = resolve("C:/work/clean-checkout");
    assert.ok(assessCheckout(checkout, "C:/outside/disposable.env", [".env.example", "package.json"]).ok);
    for (const name of [".env.local", ".env", ".env.production", ".env.development.local", ".ENV.LOCAL"]) {
      assert.ok(!assessCheckout(checkout, "C:/outside/disposable.env", [".env.example", name]).ok, name);
    }
    assert.ok(!assessCheckout(checkout, join(checkout, "disposable.env"), [".env.example"]).ok);
    assert.ok(!assessCheckout(checkout, join(checkout, "nested", "disposable.env"), [".env.example"]).ok);
  });
});

describe("the network guard", () => {
  const guard = pathToFileURL(resolve("scripts/integration/network-guard.mjs")).href;

  function probe(script: string, allowed = "") {
    const dir = mkdtempSync(join(tmpdir(), "network-guard-"));
    const log = join(dir, "network.log");
    try {
      const result = spawnSync(process.execPath, ["--import", guard, "--input-type=module", "-e", script], {
        encoding: "utf8",
        // An allowlisted environment carries no NODE_ENV; the project types require one.
        env: buildChildEnv(process.env, { INTEGRATION_ALLOWED_HOSTS: allowed, INTEGRATION_NETWORK_LOG: log }) as unknown as NodeJS.ProcessEnv,
        timeout: 20_000,
      });
      let entries: Array<{ kind: string; host?: string; outcome?: string }> = [];
      try {
        entries = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        entries = [];
      }
      return { stdout: result.stdout.trim(), entries };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("records that it loaded", () => {
    assert.ok(probe("console.log('ok')").entries.some((entry) => entry.kind === "guard-installed"));
  });

  it("blocks fetch to any external service before a connection opens", () => {
    const { stdout, entries } = probe(`
      const out = [];
      for (const url of ["https://api.resend.com/emails", "https://o0.ingest.sentry.io/api/1/envelope/", "https://example.com/"]) {
        try { await fetch(url, { method: "POST" }); out.push("sent"); } catch (error) { out.push(error.message.includes("Integration network guard") ? "blocked" : "other"); }
      }
      console.log(out.join(","));`);
    assert.equal(stdout, "blocked,blocked,blocked");
    assert.deepEqual(entries.filter((entry) => entry.kind === "blocked-fetch").map((entry) => entry.host), ["api.resend.com", "o0.ingest.sentry.io", "example.com"]);
  });

  it("answers Turnstile locally, by token, without contacting Cloudflare", () => {
    const { stdout, entries } = probe(`
      const ask = async (token) => {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: "s", response: token }) });
        return response.ok ? (await response.json()).success : response.status;
      };
      console.log(JSON.stringify([await ask("itest-pass"), await ask("itest-fail"), await ask("itest-unavailable")]));`);
    assert.equal(stdout, "[true,false,503]");
    assert.deepEqual(entries.filter((entry) => entry.kind === "turnstile").map((entry) => entry.outcome), ["pass", "fail", "unavailable"]);
    assert.ok(!entries.some((entry) => entry.kind === "blocked-fetch"));
  });

  it("allows WebSockets only to the declared hosts", () => {
    const { stdout, entries } = probe(`
      try { new WebSocket("wss://ep-bold-sea-e5f6a7b8-pooler.${REGION}/v2"); console.log("opened"); } catch (error) { console.log(error.message.includes("Integration network guard") ? "blocked" : "other"); }`,
      `${ENDPOINT}-pooler.${REGION}`);
    assert.equal(stdout, "blocked");
    assert.deepEqual(entries.filter((entry) => entry.kind === "blocked-websocket").map((entry) => entry.host), [`ep-bold-sea-e5f6a7b8-pooler.${REGION}`]);
  });

  it("records every allowed connection by host, so a run can show exactly what it reached", () => {
    // localhost on a closed port: the socket fails at once and nothing leaves the machine.
    const { stdout, entries } = probe(`
      const socket = new WebSocket("ws://localhost:9/v2");
      await new Promise((done) => { socket.onerror = done; socket.onclose = done; setTimeout(done, 3000); });
      console.log("attempted");`, "localhost");
    assert.equal(stdout, "attempted");
    assert.deepEqual(entries.filter((entry) => entry.kind === "allowed-websocket").map((entry) => entry.host), ["localhost"]);
  });
});
