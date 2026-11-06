import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  anyExportStub,
  compiledFiles,
  createBucketCounter,
  createFakePrisma,
  dependencyIds,
  loadServerRuntime,
  type Compiled,
  type ServerRuntime,
} from "./next-server-runtime";
import { MANIFEST_NAME, assertBundleProcessIsolation, listSourceFiles, sourceDigest, type BundleManifest } from "./workspace";

/**
 * Security invariants of the real Next.js production compilation.
 *
 * Runs only through `npm run test:bundle`, which builds the working tree with
 * `next build --experimental-build-mode=compile` in a temporary directory and
 * points PRODUCTION_BUNDLE_DIR at its `.next`. Every test calls or scans the
 * compiled output itself, loaded into Next's own webpack runtime
 * (`next-server-runtime.ts`); nothing is recompiled here.
 *
 * Only I/O is replaced: the database (through the application's own
 * `globalThis.cinematicPortfolioPrisma` seam), `next/headers` and `next/cache`
 * (which need a live request), the Sentry SDK, and the session lookup for the
 * authorization tests. Every credential below is fictional, and the offline
 * guard refuses any network access.
 *
 * This suite never skips: without a bundle it fails.
 */

// Before anything else: this process must be guarded and hold no real credentials.
assertBundleProcessIsolation();

const REPO = process.cwd();
const BUNDLE = process.env.PRODUCTION_BUNDLE_DIR;
if (!BUNDLE) throw new Error("PRODUCTION_BUNDLE_DIR is not set. Run `npm run test:bundle`; this suite does not skip.");
const NEXT_DIR = resolve(BUNDLE);
const SERVER = join(NEXT_DIR, "server");


/** Every runtime NODE_ENV a deployed function might see, including none at all. */
const RUNTIME_MODES = [undefined, "", "development", "test", "production", "staging"] as const;

// Fictional configuration for the compiled modules that read the environment.
process.env.BETTER_AUTH_SECRET = "fictional-better-auth-secret-for-bundle-tests";
process.env.BETTER_AUTH_URL = "https://admin.example.invalid";
process.env.DATABASE_URL = "postgresql://fictional:fictional@db.example.invalid/fictional";
const FICTIONAL_HMAC_SECRET = "fictional-rate-limit-hmac-secret-0123456789";
assert.match(process.env.BETTER_AUTH_SECRET, /^fictional-/, "Better Auth configuration must be fictional");
assert.match(process.env.BETTER_AUTH_URL, /\.example\.invalid$/, "Better Auth URL must use the reserved fictional domain");
assert.match(process.env.DATABASE_URL, /\.example\.invalid\//, "database configuration must use the reserved fictional domain");
assert.match(FICTIONAL_HMAC_SECRET, /^fictional-/, "rate-limit configuration must be fictional");

const fakePrisma = createFakePrisma();
(globalThis as { cinematicPortfolioPrisma?: unknown }).cinematicPortfolioPrisma = fakePrisma.client;

async function withEnv<T>(values: Record<string, string | undefined>, body: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(values);
  try {
    return await body();
  } finally {
    apply(saved);
  }
}

const read = (file: string) => readFileSync(file, "utf8");
const serverFiles = () => compiledFiles(SERVER);

/** Replaces `next/headers` and `next/cache`, which need a live request, with local stand-ins. */
function stubRequestScope(runtime: ServerRuntime, state: { headers: Headers; cache: Array<[string, unknown[]]> }) {
  const headerModules = runtime.find((s) => s.includes("draftMode:") && s.includes("headers:") && s.includes("cookies:"));
  const cacheModules = runtime.find((s) => s.includes("revalidatePath:") && s.includes("unstable_cache:"));
  assert.ok(headerModules.length > 0, "positive control: next/headers is in the bundle");
  assert.ok(cacheModules.length > 0, "positive control: next/cache is in the bundle");
  const cookies = { get: () => undefined, getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined };
  for (const id of headerModules) {
    runtime.stub(id, { __esModule: true, headers: async () => state.headers, cookies: async () => cookies, draftMode: async () => ({ isEnabled: false }) });
  }
  const cache = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name === "symbol" || name === "then") return undefined;
        if (name === "__esModule") return true;
        if (name === "unstable_cache") return (fn: unknown) => fn;
        return (...args: unknown[]) => {
          state.cache.push([name, args]);
        };
      },
    },
  );
  for (const id of cacheModules) runtime.stub(id, cache);
}

/**
 * The Better Auth instance exported by the compiled `src/server/auth/config.ts`.
 * Webpack also inlines a second copy of that configuration into the login
 * page's Server Action module; that copy is exercised through the action.
 */
function authInstance(runtime: ServerRuntime): Compiled {
  const candidates = runtime.find((s) => s.includes('"admin-login:account"') && s.includes("hooks:{before:"));
  assert.ok(candidates.length > 0, "positive control: the auth configuration is in the bundle");
  const instances = candidates
    .map((id) => Object.values(runtime.require(id)).find((value: Compiled) => typeof value?.api?.signInEmail === "function"))
    .filter(Boolean);
  assert.equal(instances.length, 1, "exactly one compiled module exports the auth instance");
  return instances[0];
}

type ReferenceManifest = { node: Record<string, { filename: string; exportedName: string; workers: Record<string, { moduleId: string }> }> };

/** A compiled Server Action, resolved the way Next.js dispatches it: action id → worker module export. */
async function serverAction(runtime: ServerRuntime, sourceFile: string, exportedName: string, page: string): Promise<Compiled> {
  const manifest = JSON.parse(read(join(SERVER, "server-reference-manifest.json"))) as ReferenceManifest;
  const matches = Object.entries(manifest.node).filter(([, entry]) => entry.filename.replace(/\\/g, "/").endsWith(sourceFile) && entry.exportedName === exportedName);
  assert.equal(matches.length, 1, `${exportedName} is registered once`);
  const [actionId, entry] = matches[0];
  const workerId = entry.workers[page]?.moduleId;
  assert.ok(workerId, `${exportedName} is registered for ${page}`);
  const action = (await runtime.require(workerId))[actionId];
  assert.equal(typeof action, "function", `${exportedName} dispatches to a function`);
  return action;
}

// ------------------------------------------------------------------------------------------------
describe("bundle provenance", () => {
  it("is a Next.js compile-mode production build of the current working tree", () => {
    const manifest = JSON.parse(read(join(NEXT_DIR, MANIFEST_NAME))) as BundleManifest;
    assert.equal(manifest.mode, "compile");
    assert.equal(read(join(NEXT_DIR, "BUILD_ID")).trim(), manifest.buildId);
    const files = listSourceFiles(REPO, existsSync);
    assert.equal(manifest.sourceDigest, sourceDigest(REPO, files), "the source changed after the build; rerun npm run test:bundle");
    for (const file of ["required-server-files.json", "server/webpack-runtime.js", "server/app-paths-manifest.json", "server/server-reference-manifest.json", "server/instrumentation.js"]) {
      assert.ok(existsSync(join(NEXT_DIR, file)), `${file} is present`);
    }
    const paths = JSON.parse(read(join(SERVER, "app-paths-manifest.json"))) as Record<string, string>;
    assert.ok(paths["/(admin)/admin/media/page"], "the admin media page was compiled");
    assert.ok(paths["/api/auth/[...all]/route"], "the auth route was compiled");
  });
});

// ------------------------------------------------------------------------------------------------
describe("SD-13G: the rate-limit HMAC key in the compiled server bundle", () => {
  it("contains no development fallback key in any server file", () => {
    const files = serverFiles();
    assert.ok(files.some((file) => read(file).includes("RATE_LIMIT_HMAC_SECRET")), "positive control: the limiter is in the bundle");
    assert.deepEqual(files.filter((file) => read(file).includes("development-only-rate-limit-secret")), []);
  });

  it("refuses an unset, short, or blank secret under every runtime NODE_ENV", async () => {
    const runtime = loadServerRuntime(SERVER, REPO);
    const modules = runtime.find((s) => s.includes("RATE_LIMIT_HMAC_SECRET?.trim()") && !s.includes("admin-login:"));
    assert.ok(modules.length > 0, "positive control: the shared bucket module is in the bundle");
    for (const id of modules) {
      const key = Object.values(runtime.require(id)).find((value: Compiled) => typeof value === "function" && value.toString().includes("RATE_LIMIT_HMAC_SECRET")) as Compiled;
      assert.ok(key, `module ${id} exports the key function`);
      for (const mode of RUNTIME_MODES) {
        await withEnv({ NODE_ENV: mode, RATE_LIMIT_HMAC_SECRET: undefined }, () => {
          assert.equal(key(), null, `unset, NODE_ENV=${mode}`);
          assert.equal(key({}), null);
          assert.equal(key({ RATE_LIMIT_HMAC_SECRET: "s".repeat(31) }), null);
          assert.equal(key({ RATE_LIMIT_HMAC_SECRET: " ".repeat(40) }), null);
          assert.equal(key({ RATE_LIMIT_HMAC_SECRET: ` ${FICTIONAL_HMAC_SECRET} ` }), FICTIONAL_HMAC_SECRET);
        });
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe("SD-13E: administrator sign-in limits through the compiled Better Auth instance", () => {
  const scope = { headers: new Headers(), cache: [] as Array<[string, unknown[]]> };
  let auth: Compiled;
  let buckets = createBucketCounter();

  before(() => {
    const runtime = loadServerRuntime(SERVER, REPO);
    stubRequestScope(runtime, scope);
    auth = authInstance(runtime);
  });
  beforeEach(() => {
    fakePrisma.reset();
    buckets = createBucketCounter();
    fakePrisma.handlers["$raw.$queryRaw"] = (query) => buckets.handle(query);
  });

  type Outcome = { status: string; statusCode: number; message: string; retryAfter: string | null };
  async function signIn(email: unknown, clientIp = "203.0.113.10"): Promise<Outcome> {
    try {
      await auth.api.signInEmail({ body: { email, password: "fictional-password-123" }, headers: new Headers({ "x-nf-client-connection-ip": clientIp }) });
      return { status: "SIGNED_IN", statusCode: 200, message: "", retryAfter: null };
    } catch (error) {
      const e = error as Compiled;
      const headers = e?.headers;
      const retryAfter = headers instanceof Headers ? headers.get("Retry-After") : headers?.["Retry-After"] ?? null;
      return { status: String(e?.status), statusCode: Number(e?.statusCode), message: String(e?.body?.message ?? e?.message), retryAfter };
    }
  }
  const userLookups = () => fakePrisma.calls.filter((call) => call.model === "user").length;
  const audits = () => fakePrisma.calls.filter((call) => call.model === "auditLog" && call.operation === "create");

  it("installs the guard and marks session cookies Secure", () => {
    assert.equal(typeof auth.options.hooks.before, "function");
    assert.equal(auth.options.advanced.useSecureCookies, true);
  });

  for (const mode of RUNTIME_MODES) {
    it(`fails closed without a usable HMAC secret, before any lookup (runtime NODE_ENV=${JSON.stringify(mode)})`, async () => {
      for (const secret of [undefined, "too-short-secret"]) {
        await withEnv({ NODE_ENV: mode, RATE_LIMIT_HMAC_SECRET: secret }, async () => {
          const callsBefore = fakePrisma.calls.length;
          const outcome = await signIn("editor@studio.example");
          assert.equal(outcome.status, "SERVICE_UNAVAILABLE");
          assert.equal(outcome.statusCode, 503);
          assert.equal(buckets.increments.length, 0, "no bucket was written");
          assert.equal(fakePrisma.calls.length, callsBefore, "no database call at all");
        });
      }
    });
  }

  it("allows six attempts per account, refuses the seventh with Retry-After, and audits once", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const outcome = await signIn("Admin@Studio.Example");
        assert.equal(outcome.statusCode, 401, `attempt ${attempt} reaches the password check (no such fictional user)`);
      }
      const lookupsBefore = userLookups();
      const seventh = await signIn("admin@studio.example");
      assert.equal(seventh.status, "TOO_MANY_REQUESTS");
      assert.equal(seventh.statusCode, 429);
      const retryAfter = Number(seventh.retryAfter);
      assert.ok(retryAfter >= 1 && retryAfter <= 900, `Retry-After ${seventh.retryAfter}`);
      assert.equal(userLookups(), lookupsBefore, "the refused attempt never reached the password check");
      assert.equal(audits().length, 1);
      assert.equal(audits()[0].args.data.action, "admin.sign_in_throttled");
      assert.deepEqual(audits()[0].args.data.metadata, { limits: ["account"] });
      assert.equal((await signIn("admin@studio.example")).statusCode, 429);
      assert.equal(audits().length, 1, "a continuing block is not audited again");
    });
  });

  it("keys buckets by HMAC, account before client, never by the raw address", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      await signIn("Admin@Studio.Example", "198.51.100.7");
      assert.deepEqual(buckets.increments.map((entry) => entry.scope), ["admin-login:account", "admin-login:client"]);
      for (const entry of buckets.increments) {
        assert.match(entry.keyHash, /^[0-9a-f]{64}$/);
        const serialized = JSON.stringify(entry.values).toLowerCase();
        assert.ok(!serialized.includes("admin@studio.example") && !serialized.includes("198.51.100.7"));
      }
    });
  });

  it("refuses the twenty-first attempt from one client across rotating accounts", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      for (let attempt = 1; attempt <= 20; attempt++) assert.equal((await signIn(`user${attempt}@studio.example`)).statusCode, 401);
      const outcome = await signIn("user21@studio.example");
      assert.equal(outcome.statusCode, 429);
      assert.deepEqual(audits().at(-1)?.args.data.metadata, { limits: ["client"] });
    });
  });

  it("still limits the client when the email is missing or not a string", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      await signIn(42);
      assert.deepEqual(buckets.increments.map((entry) => entry.scope), ["admin-login:client"]);
    });
  });

  it("fails closed when the limiter's storage fails, with the same wording as a limit", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      fakePrisma.failTransactions = true;
      const unavailable = await signIn("admin@studio.example");
      assert.equal(unavailable.statusCode, 503);
      assert.equal(userLookups(), 0);
      fakePrisma.failTransactions = false;
      for (let attempt = 1; attempt <= 6; attempt++) await signIn("other@studio.example");
      const limited = await signIn("other@studio.example");
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.message, unavailable.message, "429 and 503 say the same thing");
    });
  });

  it("does not count other auth endpoints", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      assert.equal(await auth.api.getSession({ headers: new Headers() }), null);
      assert.equal(buckets.increments.length, 0);
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe("SD-13E: the compiled login Server Action (its own inlined auth configuration)", () => {
  const scope = { headers: new Headers({ "x-nf-client-connection-ip": "203.0.113.20" }), cache: [] as Array<[string, unknown[]]> };
  const UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again later.";
  const GENERIC = "Unable to sign in with those credentials.";
  let signInAction: Compiled;
  let buckets = createBucketCounter();

  before(async () => {
    const runtime = loadServerRuntime(SERVER, REPO);
    stubRequestScope(runtime, scope);
    signInAction = await serverAction(runtime, "src/app/(admin)/admin/login/actions.ts", "signInAction", "app/(admin)/admin/login/page");
  });
  beforeEach(() => {
    fakePrisma.reset();
    buckets = createBucketCounter();
    fakePrisma.handlers["$raw.$queryRaw"] = (query) => buckets.handle(query);
  });

  const quietly = async <T>(body: () => Promise<T>): Promise<T> => {
    const { warn, error } = console;
    console.warn = () => undefined;
    console.error = () => undefined;
    try {
      return await body();
    } finally {
      Object.assign(console, { warn, error });
    }
  };
  const attempt = (email: string) => quietly(() => signInAction({ email, password: "fictional-password-123" }));
  const auditActions = () => fakePrisma.calls.filter((call) => call.model === "auditLog" && call.operation === "create").map((call) => call.args.data.action);

  for (const mode of RUNTIME_MODES) {
    it(`answers "unavailable" without a usable HMAC secret, before any lookup (runtime NODE_ENV=${JSON.stringify(mode)})`, async () => {
      await withEnv({ NODE_ENV: mode, RATE_LIMIT_HMAC_SECRET: undefined }, async () => {
        assert.deepEqual(await attempt("admin@studio.example"), { ok: false, message: UNAVAILABLE });
        assert.equal(buckets.increments.length, 0);
        assert.ok(!fakePrisma.calls.some((call) => call.model === "user"), "the password check was never reached");
      });
    });
  }

  it("answers generically for six failed attempts, then refuses the seventh and audits the throttle", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      for (let n = 1; n <= 6; n++) assert.deepEqual(await attempt("admin@studio.example"), { ok: false, message: GENERIC });
      assert.deepEqual(auditActions(), Array(6).fill("admin.sign_in_failed"));
      const lookups = fakePrisma.calls.filter((call) => call.model === "user").length;
      assert.deepEqual(await attempt("admin@studio.example"), { ok: false, message: UNAVAILABLE });
      assert.equal(fakePrisma.calls.filter((call) => call.model === "user").length, lookups, "the refused attempt never reached the password check");
      assert.deepEqual(auditActions().slice(6), ["admin.sign_in_throttled"]);
      assert.deepEqual([...new Set(buckets.increments.map((entry) => entry.scope))], ["admin-login:account", "admin-login:client"]);
    });
  });

  it("answers \"unavailable\" when the limiter's storage fails", async () => {
    await withEnv({ RATE_LIMIT_HMAC_SECRET: FICTIONAL_HMAC_SECRET }, async () => {
      fakePrisma.failTransactions = true;
      assert.deepEqual(await attempt("admin@studio.example"), { ok: false, message: UNAVAILABLE });
      assert.ok(!fakePrisma.calls.some((call) => call.model === "user"));
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe("SD-13H: the compiled Turnstile verifier", () => {
  const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  let verify: Compiled;
  let verifierText = "";

  before(() => {
    const holders = serverFiles().filter((file) => read(file).includes(VERIFY_URL));
    assert.equal(holders.length, 1, "positive control: exactly one server file holds the verifier");
    const text = read(holders[0]);
    assert.equal(text.split(VERIFY_URL).length - 1, 1, "exactly one verifier");
    // The verifier is inlined into the contact page module, not exported, so its
    // exact compiled text is extracted and evaluated with its one module-level flag.
    const start = text.lastIndexOf("async function ", text.indexOf(VERIFY_URL));
    let depth = 0;
    let end = text.indexOf("{", text.indexOf(")", start));
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    verifierText = text.slice(start, end + 1);
    const name = /^async function ([\w$]+)\(/.exec(verifierText)?.[1];
    const flag = /\|\|([\w$]+)\|\|\(\1=!0,console\.error\("\[security\] Turnstile is not configured/.exec(verifierText)?.[1];
    assert.ok(name && flag, "the compiled verifier has the expected shape");
    verify = new Function(`let ${flag}=!1;${verifierText};return ${name};`)();
  });

  const KEYS = { TURNSTILE_SITE_KEY: "fictional-site-key", TURNSTILE_SECRET_KEY: "fictional-secret-key", TURNSTILE_EXPECTED_HOSTNAME: "studio.example" };
  function provider(body: unknown, ok = true) {
    const calls: Array<[string, Compiled]> = [];
    const fetcher = async (url: string, init: Compiled) => {
      calls.push([url, init]);
      return { ok, json: async () => body };
    };
    return { calls, fetcher };
  }

  it("contains no development bypass", () => {
    assert.ok(!verifierText.includes("NODE_ENV"));
    assert.deepEqual(serverFiles().filter((file) => read(file).includes("bypassed:!0")), []);
  });

  for (const mode of RUNTIME_MODES) {
    it(`refuses unconfigured verification without contacting the provider (runtime NODE_ENV=${JSON.stringify(mode)})`, async () => {
      const originalError = console.error;
      console.error = () => undefined;
      try {
        await withEnv({ NODE_ENV: mode, TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined }, async () => {
          for (const env of [{}, undefined, { TURNSTILE_SITE_KEY: "fictional-site-key" }, { TURNSTILE_SECRET_KEY: "fictional-secret-key" }]) {
            const fake = provider({ success: true });
            assert.deepEqual(await verify({ token: "fictional-token" }, { env, fetcher: fake.fetcher }), { ok: false, reason: "misconfigured" });
            assert.equal(fake.calls.length, 0);
          }
        });
      } finally {
        console.error = originalError;
      }
    });
  }

  it("accepts only a fresh, matching provider answer", async () => {
    const good = provider({ success: true, hostname: "studio.example", action: "inquiry", challenge_ts: new Date().toISOString() });
    assert.deepEqual(await verify({ token: "fictional-token", remoteIp: "203.0.113.9" }, { env: KEYS, fetcher: good.fetcher }), { ok: true, bypassed: false });
    assert.equal(good.calls[0][0], VERIFY_URL);
    assert.equal(good.calls[0][1].body.get("secret"), "fictional-secret-key");
    assert.equal(good.calls[0][1].body.get("remoteip"), "203.0.113.9");
    const refusals: Array<[unknown, boolean, string]> = [
      [{ success: false }, true, "invalid"],
      [{ success: true, hostname: "elsewhere.example" }, true, "invalid"],
      [{ success: true, hostname: "studio.example", action: "login" }, true, "invalid"],
      [{ success: true, hostname: "studio.example", challenge_ts: "2000-01-01T00:00:00Z" }, true, "invalid"],
      [{ success: true }, false, "unavailable"],
    ];
    for (const [body, ok, reason] of refusals) {
      assert.deepEqual(await verify({ token: "fictional-token" }, { env: KEYS, fetcher: provider(body, ok).fetcher }), { ok: false, reason });
    }
    assert.deepEqual(await verify({ token: "" }, { env: KEYS, fetcher: provider({ success: true }).fetcher }), { ok: false, reason: "invalid" });
    assert.deepEqual(await verify({ token: "x".repeat(2049) }, { env: KEYS, fetcher: provider({ success: true }).fetcher }), { ok: false, reason: "invalid" });
    const failing = async () => {
      throw new Error("offline");
    };
    assert.deepEqual(await verify({ token: "fictional-token" }, { env: KEYS, fetcher: failing }), { ok: false, reason: "unavailable" });
  });
});

// ------------------------------------------------------------------------------------------------
describe("DEF-01: media actions through the compiled Server Action dispatch", () => {
  const scope = { headers: new Headers(), cache: [] as Array<[string, unknown[]]> };
  const MEDIA_ID = "3f0e9c1a-2b4d-4c6e-8f10-1a2b3c4d5e6f";
  let actor: { id: string; name: string; email: string; role: string } | null = null;
  let deleteAction: Compiled;
  let metadataAction: Compiled;

  before(async () => {
    const runtime = loadServerRuntime(SERVER, REPO);
    stubRequestScope(runtime, scope);
    // The session lookup reads a signed cookie; it is the one auth call replaced.
    authInstance(runtime).api.getSession = async () => (actor ? { user: { id: actor.id }, session: { id: "fictional-session" } } : null);

    const source = "src/app/(admin)/admin/media/actions.ts";
    deleteAction = await serverAction(runtime, source, "deleteMediaAction", "app/(admin)/admin/media/page");
    metadataAction = await serverAction(runtime, source, "updateMediaMetadataAction", "app/(admin)/admin/media/page");
  });
  beforeEach(() => {
    fakePrisma.reset();
    scope.cache.length = 0;
    fakePrisma.handlers["user.findUnique"] = () => actor;
  });

  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) data.set(name, value);
    return data;
  };
  const as = (role: string | null) => {
    actor = role ? { id: "00000000-0000-4000-8000-0000000000a1", name: "Fictional Person", email: "person@studio.example", role } : null;
  };
  const mediaCalls = () => fakePrisma.calls.filter((call) => call.model === "media" || call.model === "projectMedia" || call.model === "auditLog");
  const settle = (promise: Promise<unknown>) => promise.then((value) => ({ value, error: null as Compiled }), (error) => ({ value: undefined, error }));

  it("refuses an EDITOR's delete before parsing or touching media", async () => {
    for (const id of [MEDIA_ID, "not-a-uuid"]) {
      as("EDITOR");
      const { error } = await settle(deleteAction(null, form({ id })));
      assert.match(String(error?.message), /Requires role ADMIN or higher/);
      assert.deepEqual(mediaCalls(), []);
      assert.deepEqual(scope.cache, []);
    }
  });

  it("refuses an unknown role value", async () => {
    as("OWNER");
    const { error } = await settle(deleteAction(null, form({ id: MEDIA_ID })));
    assert.ok(error);
    assert.deepEqual(mediaCalls(), []);
  });

  it("redirects an unauthenticated delete to sign-in", async () => {
    as(null);
    const { error } = await settle(deleteAction(null, form({ id: MEDIA_ID })));
    assert.match(String(error?.digest), /^NEXT_REDIRECT;.*\/admin\/login/);
    assert.deepEqual(mediaCalls(), []);
  });

  for (const role of ["ADMIN", "SUPER_ADMIN"]) {
    it(`lets ${role} reach the real deleteMedia service`, async () => {
      as(role);
      assert.equal(await deleteAction(null, form({ id: MEDIA_ID })), null);
      assert.deepEqual(mediaCalls().map((call) => `${call.model}.${call.operation}`), ["media.findUnique"]);
      assert.equal(mediaCalls()[0].args.where.id, MEDIA_ID);
      assert.ok(scope.cache.some(([name, args]) => name === "revalidatePath" && args[0] === "/admin/media"));
    });
  }

  it("returns the in-use refusal as form state when an ADMIN deletes an assigned image", async () => {
    as("ADMIN");
    fakePrisma.handlers["media.findUnique"] = () => ({ id: MEDIA_ID, objectKey: "fictional/master.webp", variants: [] });
    fakePrisma.handlers["projectMedia.count"] = () => 1;
    const result = await deleteAction(null, form({ id: MEDIA_ID }));
    assert.match(String(result?.error), /assigned to a project/);
    assert.ok(!fakePrisma.calls.some((call) => call.model === "media" && call.operation === "delete"));
  });

  it("keeps EDITOR metadata edits", async () => {
    as("EDITOR");
    await metadataAction(form({ id: MEDIA_ID, altText: "  Fictional alt  ", caption: "" }));
    const update = fakePrisma.calls.find((call) => call.model === "media" && call.operation === "update");
    assert.deepEqual(update?.args.where, { id: MEDIA_ID });
    assert.deepEqual(update?.args.data, { altText: "Fictional alt", caption: null });
    assert.ok(fakePrisma.calls.some((call) => call.model === "auditLog" && call.operation === "create"));
  });

  it("redirects an unauthenticated metadata edit without writing", async () => {
    as(null);
    const { error } = await settle(metadataAction(form({ id: MEDIA_ID, altText: "a", caption: "b" })));
    assert.match(String(error?.digest), /^NEXT_REDIRECT;/);
    assert.deepEqual(mediaCalls(), []);
  });
});

// ------------------------------------------------------------------------------------------------
describe("DEF-02: compiled server Sentry initialization", () => {
  const DSN = "https://fictionalkey@o0.ingest.sentry.example.invalid/123";
  let runtime: ServerRuntime;
  let configId = "";
  let sdkId = "";

  before(() => {
    runtime = loadServerRuntime(SERVER, REPO);
    configId = runtime.findOne("the server Sentry configuration", (s) => s.includes('NODE_ENV:"production"})') && s.includes("NEXT_PUBLIC_SENTRY_DSN") && s.includes(".init("));
    const dependencies = dependencyIds(runtime.source(configId));
    assert.equal(dependencies.length, 1, "the compiled config depends on the Sentry SDK only");
    sdkId = dependencies[0];
  });

  function initialize(mode: string | undefined, env: Record<string, string | undefined>) {
    const inits: Compiled[] = [];
    return withEnv({ NODE_ENV: mode, NEXT_PUBLIC_SENTRY_DSN: undefined, NEXT_PUBLIC_SENTRY_ENVIRONMENT: undefined, NEXT_PUBLIC_SENTRY_RELEASE: undefined, ...env }, () => {
      runtime.runFactory(configId, { [sdkId]: anyExportStub((options: Compiled) => inits.push(options)) });
      return inits;
    });
  }

  it("inlines NODE_ENV and is loaded unconditionally by register()", () => {
    assert.ok(runtime.source(configId).includes('{...process.env,NODE_ENV:"production"}'));
    const instrumentation = read(join(SERVER, "instrumentation.js"));
    const registerName = /register:\(\)=>([\w$]+)[,}]/.exec(instrumentation)?.[1];
    assert.ok(registerName, "instrumentation exports register");
    assert.match(instrumentation, /onRequestError:\(\)=>/);
    const start = instrumentation.indexOf(`async function ${registerName}(){`);
    assert.ok(start >= 0);
    const body = instrumentation.slice(start, instrumentation.indexOf("}", start) + 1);
    assert.ok(!body.includes("NEXT_RUNTIME"), `register has no runtime condition: ${body}`);
    const loaded = /\.bind\([\w$]+,(\d+)\)/.exec(body)?.[1];
    assert.equal(loaded, configId, "register() imports exactly the verified config module");
  });

  for (const mode of RUNTIME_MODES) {
    it(`initializes once with a valid runtime DSN (runtime NODE_ENV=${JSON.stringify(mode)})`, async () => {
      const inits = await initialize(mode, { NEXT_PUBLIC_SENTRY_DSN: ` ${DSN} ` });
      assert.equal(inits.length, 1);
      assert.equal(inits[0].dsn, DSN);
      assert.equal(inits[0].environment, "production");
    });

    it(`does not initialize with a missing or invalid DSN (runtime NODE_ENV=${JSON.stringify(mode)})`, async () => {
      for (const dsn of [undefined, "", "   ", "http://k@o0.ingest.sentry.example.invalid/1", "https://o0.ingest.sentry.example.invalid/1", "https://k@o0.ingest.sentry.example.invalid/", "https://k@o0.ingest.sentry.example.invalid/abc", "not a url"]) {
        assert.equal((await initialize(mode, { NEXT_PUBLIC_SENTRY_DSN: dsn })).length, 0, `DSN ${JSON.stringify(dsn)}`);
      }
    });
  }

  it("honours the runtime environment and release labels", async () => {
    const [options] = await initialize("staging", { NEXT_PUBLIC_SENTRY_DSN: DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "preview", NEXT_PUBLIC_SENTRY_RELEASE: "fictional-release" });
    assert.equal(options.environment, "preview");
    assert.equal(options.release, "fictional-release");
  });

  it("keeps every privacy restriction", async () => {
    const [options] = await initialize(undefined, { NEXT_PUBLIC_SENTRY_DSN: DSN });
    assert.deepEqual(options.dataCollection, {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 5,
    });
    assert.equal(options.sendClientReports, false);
    assert.equal(options.beforeSendTransaction({}), null);
    assert.ok(!("tracesSampleRate" in options) && !("tracesSampler" in options));
    const kept = options.integrations(["BrowserTracing", "BrowserSession", "ProcessSession", "Console", "LocalVariables", "LocalVariablesAsync", "Http"].map((name) => ({ name })));
    assert.deepEqual(kept.map((integration: { name: string }) => integration.name), ["Http"]);
    const event = options.beforeSend({
      user: { ip_address: "203.0.113.1" },
      message: "failed for person@studio.example token=fictional-token",
      request: { cookies: { session: "x" }, headers: { cookie: "session=x" }, data: "name=Person", query_string: "a=b", url: "https://studio.example/contact?email=person@studio.example" },
      exception: { values: [{ value: "postgresql://fictional:fictional@db.example.invalid/x" }] },
      contexts: { nextjs: { request_path: "/work?x=1" } },
    });
    assert.equal(event.user, undefined);
    for (const field of ["cookies", "headers", "data", "query_string"]) assert.equal(event.request[field], undefined, field);
    assert.equal(event.request.url, "https://studio.example/contact");
    assert.ok(!event.message.includes("person@studio.example") && !event.message.includes("fictional-token"));
    assert.ok(!event.exception.values[0].value.includes("fictional:fictional@"));
    assert.equal(event.contexts.nextjs.request_path, "/work");
    assert.equal(options.beforeBreadcrumb({ category: "console", message: "x" }), null);
  });

  it("skips digest errors in every compiled browser error boundary", () => {
    const boundaries = compiledFiles(join(NEXT_DIR, "static", "chunks")).filter((file) => /([\w$]+)\.digest\|\|[\w$]+\.[\w$]+\(\1,\{tags:\{boundary:/.test(read(file)));
    assert.ok(boundaries.length >= 3, `public, admin, and global boundaries (found ${boundaries.length})`);
  });
});

after(() => {
  delete (globalThis as { cinematicPortfolioPrisma?: unknown }).cinematicPortfolioPrisma;
});
