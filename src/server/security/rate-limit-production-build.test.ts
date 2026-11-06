import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, describe, it } from "node:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { assertBundleProcessIsolation } from "../../../scripts/bundle/workspace";
import { createLoginGuard, type LoginGuardCategory } from "@/server/auth/login-rate-limit";

if (process.env.PRODUCTION_BUNDLE_DIR) assertBundleProcessIsolation();

/**
 * The pseudonymization key as a production build sees it.
 *
 * Setting process.env.NODE_ENV in a test only shows what happens at runtime. The
 * defect was that a production bundle consulted the runtime value at all. So
 * these tests compile the real modules the way `next build` does, with
 * `process.env.NODE_ENV` replaced by "production" and the result minified, and
 * then run that output under every runtime NODE_ENV a deployed function could
 * see. esbuild ships with tsx, so this adds no dependency.
 */

const FALLBACK = "development-only-rate-limit-secret";
const SECRET = "p".repeat(32);

type BucketsModule = { rateLimitHmacKey: (env?: Record<string, string | undefined>) => string | null };
type InquiryModule = {
  consumeInquiryLimit: (
    identity: { submissionToken: string; normalizedEmail: string; trustedClientIp?: string },
    now?: Date,
  ) => Promise<{ allowed: boolean; configured: boolean }>;
};

/** Stands in for the Prisma client, recording whether the limiter reached storage. */
type PrismaStub = { calls: string[] };
const stubGlobal = globalThis as typeof globalThis & { __rateLimitPrismaStub?: PrismaStub };

const STUBS: Record<string, string> = {
  "server-only": "export {};",
  "@/generated/prisma/client": `export const Prisma = { sql: (strings, ...values) => ({ text: strings.join("?"), values }) };`,
  "@/server/db/prisma": `
    const stub = () => globalThis.__rateLimitPrismaStub;
    export const prisma = {
      $transaction: async (run) => { stub().calls.push("$transaction"); return run({ $queryRaw: async () => { stub().calls.push("$queryRaw"); return [{ count: 1 }]; } }); },
      $executeRaw: async () => { stub().calls.push("$executeRaw"); return 0; },
    };`,
};

let outDir: string;

async function compile(entry: string, mode: "production" | "development"): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: mode === "production",
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    logLevel: "silent",
    plugins: [
      {
        name: "stubs",
        setup(builder) {
          builder.onResolve({ filter: /^(server-only|@\/generated\/prisma\/client|@\/server\/db\/prisma)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

async function load<T>(entry: string, mode: "production" | "development"): Promise<{ module: T; code: string }> {
  const code = await compile(entry, mode);
  const file = join(outDir, `${entry.replace(/[^a-z0-9]+/gi, "-")}-${mode}.mjs`);
  writeFileSync(file, code);
  return { module: (await import(pathToFileURL(file).href)) as T, code };
}

/** Runs `run` with the runtime NODE_ENV set to `value`, or removed when undefined. */
async function withRuntimeNodeEnv<T>(value: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
}

/** Every runtime value a production function might see, including none at all. */
const RUNTIME_MODES = [undefined, "", "production", "development", "test", "staging"];

let production: { module: BucketsModule; code: string };
let development: { module: BucketsModule; code: string };

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), "rate-limit-build-"));
  production = await load<BucketsModule>("src/server/security/rate-limit-buckets.ts", "production");
  development = await load<BucketsModule>("src/server/security/rate-limit-buckets.ts", "development");
});

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("the rate-limit key in a production build", () => {
  it("uses a valid configured secret, whatever the runtime NODE_ENV", async () => {
    for (const runtime of RUNTIME_MODES) {
      await withRuntimeNodeEnv(runtime, () => {
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: SECRET }), SECRET, String(runtime));
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: `  ${SECRET}  ` }), SECRET, String(runtime));
      });
    }
  });

  it("refuses when the secret is missing, even if the runtime claims development or test", async () => {
    for (const runtime of RUNTIME_MODES) {
      await withRuntimeNodeEnv(runtime, () => {
        assert.equal(production.module.rateLimitHmacKey({}), null, String(runtime));
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: "" }), null, String(runtime));
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: " ".repeat(40) }), null, String(runtime));
        // The env argument cannot talk a production build into the fallback either.
        assert.equal(production.module.rateLimitHmacKey({ NODE_ENV: "development" }), null, String(runtime));
      });
    }
  });

  it("refuses a secret shorter than 32 characters", async () => {
    for (const runtime of RUNTIME_MODES) {
      await withRuntimeNodeEnv(runtime, () => {
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: "too-short" }), null, String(runtime));
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: "x".repeat(31) }), null, String(runtime));
        assert.equal(production.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: ` ${"x".repeat(31)} ` }), null, String(runtime));
      });
    }
  });

  it("reads the runtime environment by default, not a value fixed at build time", async () => {
    await withRuntimeNodeEnv(undefined, () => {
      const env = process.env as Record<string, string | undefined>;
      const previous = env.RATE_LIMIT_HMAC_SECRET;
      try {
        env.RATE_LIMIT_HMAC_SECRET = SECRET;
        assert.equal(production.module.rateLimitHmacKey(), SECRET);
        delete env.RATE_LIMIT_HMAC_SECRET;
        assert.equal(production.module.rateLimitHmacKey(), null);
      } finally {
        if (previous === undefined) delete env.RATE_LIMIT_HMAC_SECRET;
        else env.RATE_LIMIT_HMAC_SECRET = previous;
      }
    });
  });

  it("does not contain the predictable fallback key at all", () => {
    assert.ok(!production.code.includes(FALLBACK), "fallback key is in the production output");
    assert.ok(!/NODE_ENV/.test(production.code), "the production output still consults NODE_ENV at runtime");
    // Positive control: the same source compiled for development keeps it.
    assert.ok(development.code.includes(FALLBACK));
  });
});

describe("the rate-limit key outside a production build", () => {
  it("keeps the fallback in a development build, so `next dev` works without a secret", async () => {
    await withRuntimeNodeEnv(undefined, () => assert.equal(development.module.rateLimitHmacKey({}), FALLBACK));
    await withRuntimeNodeEnv(undefined, () => assert.equal(development.module.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: SECRET }), SECRET));
  });

  // tsx leaves process.env.NODE_ENV in place, the same as any uncompiled server.
  it("uncompiled, falls back only when the runtime is explicitly development or test", async () => {
    const source = await import("@/server/security/rate-limit-buckets");
    for (const runtime of ["development", "test"]) {
      await withRuntimeNodeEnv(runtime, () => {
        assert.equal(source.rateLimitHmacKey({}), FALLBACK, runtime);
        assert.equal(source.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: SECRET }), SECRET, runtime);
      });
    }
  });

  it("uncompiled, refuses when the runtime mode is missing, production or unexpected", async () => {
    const source = await import("@/server/security/rate-limit-buckets");
    for (const runtime of [undefined, "", "production", "staging"]) {
      await withRuntimeNodeEnv(runtime, () => {
        assert.equal(source.rateLimitHmacKey({}), null, String(runtime));
        assert.equal(source.rateLimitHmacKey({ RATE_LIMIT_HMAC_SECRET: "too-short" }), null, String(runtime));
      });
    }
  });
});

describe("administrator sign-in with a production-built key", () => {
  const OWNER = "owner@example.test";
  const PASSWORD = "sentinel-correct-password";
  const BASE_URL = "http://localhost:3000";

  async function signIn(secretEnv: Record<string, string | undefined>) {
    const database = { user: [] as unknown[], account: [] as unknown[], session: [] as unknown[], verification: [] as unknown[] };
    const logs: LoginGuardCategory[] = [];
    let increments = 0;
    const auth = betterAuth({
      secret: "s".repeat(32),
      baseURL: BASE_URL,
      trustedOrigins: [BASE_URL],
      database: memoryAdapter(database),
      emailAndPassword: { enabled: true, disableSignUp: true },
      logger: { disabled: true },
      hooks: {
        before: createLoginGuard({
          // The compiled production function, exactly as config.ts wires it.
          hmacKey: () => production.module.rateLimitHmacKey(secretEnv),
          increment: async (list) => { increments += 1; return list.map(() => 1); },
          prune: async () => undefined,
          log: (category) => { logs.push(category); },
          auditLimited: async () => undefined,
        }),
      },
    });
    const context = await auth.$context;
    const now = new Date();
    database.user.push({ id: "owner-id", name: "Owner", email: OWNER, emailVerified: true, image: null, createdAt: now, updatedAt: now });
    database.account.push({ id: "account-id", userId: "owner-id", accountId: "owner-id", providerId: "credential", password: await context.password.hash(PASSWORD), createdAt: now, updatedAt: now });

    const response = await auth.handler(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email: OWNER, password: PASSWORD }),
    }));
    return { response, logs, increments, sessions: database.session.length };
  }

  for (const [label, env] of [["missing", {}], ["short", { RATE_LIMIT_HMAC_SECRET: "too-short" }]] as const) {
    it(`refuses even correct credentials when the secret is ${label}, with no runtime NODE_ENV`, async () => {
      const { response, logs, increments, sessions } = await withRuntimeNodeEnv(undefined, () => signIn(env));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(sessions, 0);
      assert.equal(increments, 0, "no counter was written under an unusable key");
      assert.deepEqual(logs, ["limit_unconfigured"]);
    });
  }

  it("allows correct credentials when the secret is valid", async () => {
    const { response, logs, increments, sessions } = await withRuntimeNodeEnv(undefined, () => signIn({ RATE_LIMIT_HMAC_SECRET: SECRET }));
    assert.equal(response.status, 200);
    assert.equal(sessions, 1);
    assert.equal(increments, 1);
    assert.deepEqual(logs, []);
  });
});

describe("the inquiry limiter in a production build", () => {
  let inquiry: InquiryModule;
  const identity = { submissionToken: "token", normalizedEmail: "client@example.test" };
  const env = process.env as Record<string, string | undefined>;
  const previousSecret = env.RATE_LIMIT_HMAC_SECRET;

  before(async () => {
    inquiry = (await load<InquiryModule>("src/server/security/rate-limit.ts", "production")).module;
  });
  afterEach(() => {
    if (previousSecret === undefined) delete env.RATE_LIMIT_HMAC_SECRET;
    else env.RATE_LIMIT_HMAC_SECRET = previousSecret;
    delete stubGlobal.__rateLimitPrismaStub;
  });

  it("refuses without touching storage when the secret is missing or short", async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      for (const secret of [undefined, "too-short"]) {
        if (secret === undefined) delete env.RATE_LIMIT_HMAC_SECRET;
        else env.RATE_LIMIT_HMAC_SECRET = secret;
        for (const runtime of [undefined, "development", "test"]) {
          stubGlobal.__rateLimitPrismaStub = { calls: [] };
          const result = await withRuntimeNodeEnv(runtime, () => inquiry.consumeInquiryLimit(identity));
          assert.deepEqual(result, { allowed: false, configured: false }, `${secret} / ${runtime}`);
          assert.deepEqual(stubGlobal.__rateLimitPrismaStub.calls, []);
        }
      }
    } finally {
      console.error = originalError;
    }
    // Warned once, by variable name only.
    assert.equal(errors.length, 1);
    assert.ok(!JSON.stringify(errors).includes("too-short"));
  });

  it("counts normally when the secret is valid", async () => {
    env.RATE_LIMIT_HMAC_SECRET = SECRET;
    stubGlobal.__rateLimitPrismaStub = { calls: [] };
    const result = await withRuntimeNodeEnv(undefined, () => inquiry.consumeInquiryLimit(identity));
    assert.deepEqual(result, { allowed: true, configured: true });
    assert.ok(stubGlobal.__rateLimitPrismaStub.calls.includes("$queryRaw"));
  });
});

/**
 * The real `next build` output. `npm run test:bundle` builds one offline and
 * sets PRODUCTION_BUNDLE_DIR, and then this must run. Without it, `npm test`
 * uses `.next` only when a build newer than the key's source is on disk, and
 * otherwise skips rather than trusting a stale bundle.
 */
describe("the compiled Next.js server bundle", () => {
  const bundleDir = process.env.PRODUCTION_BUNDLE_DIR;
  const nextDir = bundleDir ?? ".next";
  const serverDir = join(nextDir, "server");
  const buildId = join(nextDir, "BUILD_ID");
  const sourceFile = "src/server/security/rate-limit-buckets.ts";
  const fresh = bundleDir !== undefined || (existsSync(buildId) && statSync(buildId).mtimeMs > statSync(sourceFile).mtimeMs);
  const options = fresh ? {} : { skip: "no production build newer than rate-limit-buckets.ts" };

  function serverFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return serverFiles(path);
      return /\.(js|mjs|cjs)$/.test(entry.name) ? [path] : [];
    });
  }

  it("contains no predictable fallback key", options, () => {
    const files = serverFiles(serverDir);
    const withKeyCode = files.filter((file) => readFileSync(file, "utf8").includes("RATE_LIMIT_HMAC_SECRET"));
    assert.ok(withKeyCode.length > 0, "positive control: the limiter is in the bundle");
    const leaking = files.filter((file) => readFileSync(file, "utf8").includes(FALLBACK));
    assert.deepEqual(leaking, []);
  });
});
