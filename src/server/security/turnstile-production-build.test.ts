import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

import { assertBundleProcessIsolation } from "../../../scripts/bundle/workspace";
import { emptyStates } from "@/content/site";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/security/turnstile-widget";
import { submitInquiryWorkflow, type SubmitInquiryDependencies } from "@/server/inquiry/submit-inquiry";
import type { TurnstileResult, verifyTurnstile as VerifyTurnstile } from "@/server/security/turnstile";

if (process.env.PRODUCTION_BUNDLE_DIR) assertBundleProcessIsolation();

/**
 * Turnstile verification as a production build sees it.
 *
 * Setting process.env.NODE_ENV in a test shows only runtime behaviour. The defect
 * was that the production bundle consulted the runtime value at all, so these
 * tests compile the real module the way `next build` does (`process.env.NODE_ENV`
 * replaced with "production", minified) and run the output under every runtime
 * NODE_ENV a deployed function could see. Every provider response is a local
 * fake: nothing here contacts Cloudflare. esbuild ships with tsx.
 */

type Verify = typeof VerifyTurnstile;
type Fetcher = typeof fetch;

const SITE = "site-key-sentinel";
const SECRET = "secret-key-sentinel";
const HOSTNAME = "studio.example";
const CONFIGURED = { TURNSTILE_SITE_KEY: SITE, TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME };
/** Every runtime value a production function might see, including none at all. */
const RUNTIME_MODES = [undefined, "", "production", "development", "test", "staging"];

let outDir: string;

async function compile(mode: "production" | "development"): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/server/security/turnstile.ts"],
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
        name: "server-only",
        setup(builder) {
          builder.onResolve({ filter: /^server-only$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

/** A fresh module instance each time, so the once-only warning starts unset. */
let loads = 0;
async function load(mode: "production" | "development"): Promise<{ verify: Verify; code: string }> {
  const code = await compile(mode);
  const file = join(outDir, `turnstile-${mode}-${loads++}.mjs`);
  writeFileSync(file, code);
  return { verify: ((await import(pathToFileURL(file).href)) as { verifyTurnstile: Verify }).verifyTurnstile, code };
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

/** Silences and records console.error for the duration of `run`. */
async function capturingErrors<T>(run: () => Promise<T>): Promise<{ result: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    return { result: await run(), errors };
  } finally {
    console.error = original;
  }
}

/** A fake provider that records each call and answers with `body`, or fails as told. */
function provider(answer: { body?: unknown; ok?: boolean; throws?: unknown; hang?: boolean } = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (answer.throws) throw answer.throws;
    if (answer.hang) {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    return { ok: answer.ok ?? true, json: async () => answer.body } as Response;
  }) as Fetcher;
  return { fetcher, calls };
}

const success = () => ({ success: true, hostname: HOSTNAME, action: "inquiry", challenge_ts: new Date().toISOString() });

let production: { verify: Verify; code: string };
let development: { verify: Verify; code: string };

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), "turnstile-build-"));
  production = await load("production");
  development = await load("development");
});

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("Turnstile in a production build", () => {
  it("accepts a valid challenge with valid configuration, whatever the runtime NODE_ENV", async () => {
    for (const runtime of RUNTIME_MODES) {
      const fake = provider({ body: success() });
      const result = await withRuntimeNodeEnv(runtime, () => production.verify({ token: "token", remoteIp: "192.0.2.1" }, { env: CONFIGURED, fetcher: fake.fetcher }));
      assert.deepEqual(result, { ok: true, bypassed: false }, String(runtime));
      assert.equal(fake.calls.length, 1);
      assert.match(fake.calls[0]!.url, /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
      const sent = new URLSearchParams(fake.calls[0]!.body);
      assert.equal(sent.get("secret"), SECRET);
      assert.equal(sent.get("response"), "token");
      assert.equal(sent.get("remoteip"), "192.0.2.1");
    }
  });

  const missing: Array<[string, Record<string, string | undefined>]> = [
    ["the site key is missing", { TURNSTILE_SECRET_KEY: SECRET }],
    ["the secret key is missing", { TURNSTILE_SITE_KEY: SITE }],
    ["both keys are missing", {}],
    ["both keys are blank", { TURNSTILE_SITE_KEY: "  ", TURNSTILE_SECRET_KEY: "\t" }],
    ["only the hostname is set", { TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME }],
  ];
  for (const [label, env] of missing) {
    it(`refuses as misconfigured when ${label}, whatever the runtime NODE_ENV`, async () => {
      for (const runtime of RUNTIME_MODES) {
        for (const token of ["", "token"]) {
          const fake = provider({ body: success() });
          const result = await withRuntimeNodeEnv(runtime, () => production.verify({ token }, { env, fetcher: fake.fetcher }));
          assert.deepEqual(result, { ok: false, reason: "misconfigured" }, `${String(runtime)} / "${token}"`);
          assert.equal(fake.calls.length, 0, "no provider call without configuration");
        }
      }
    });
  }

  it("cannot be talked into the bypass by a NODE_ENV in the env argument", async () => {
    for (const NODE_ENV of ["development", "test"]) {
      const result = await withRuntimeNodeEnv(undefined, () => production.verify({ token: "" }, { env: { NODE_ENV } }));
      assert.deepEqual(result, { ok: false, reason: "misconfigured" }, NODE_ENV);
    }
  });

  it("warns once about missing configuration, even with no runtime NODE_ENV", async () => {
    const fresh = await load("production");
    const { errors } = await capturingErrors(() => withRuntimeNodeEnv(undefined, async () => {
      await fresh.verify({ token: "token" }, { env: {} });
      await fresh.verify({ token: "token" }, { env: { TURNSTILE_SITE_KEY: SITE } });
    }));
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]![0]), /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY/);
    assert.ok(!JSON.stringify(errors).includes(SITE), "names variables, never values");
  });

  it("rejects invalid tokens and challenges", async () => {
    for (const runtime of RUNTIME_MODES) {
      await withRuntimeNodeEnv(runtime, async () => {
        for (const token of ["", "x".repeat(2049)]) {
          const fake = provider({ body: success() });
          assert.deepEqual(await production.verify({ token }, { env: CONFIGURED, fetcher: fake.fetcher }), { ok: false, reason: "invalid" });
          assert.equal(fake.calls.length, 0, "no provider call for a token that cannot be valid");
        }
        const rejected = [
          { success: false, "error-codes": ["invalid-input-response"] },
          { ...success(), hostname: "evil.example" },
          { ...success(), action: "login" },
          { ...success(), challenge_ts: new Date(Date.now() - 10 * 60_000).toISOString() },
          { ...success(), challenge_ts: "not-a-date" },
          {},
        ];
        for (const body of rejected) {
          const fake = provider({ body });
          assert.deepEqual(await production.verify({ token: "token" }, { env: CONFIGURED, fetcher: fake.fetcher }), { ok: false, reason: "invalid" }, JSON.stringify(body));
        }
      });
    }
  });

  it("refuses as unavailable when the verification service fails", async () => {
    const faults: Array<[string, Parameters<typeof provider>[0]]> = [
      ["a network error", { throws: new TypeError("fetch failed") }],
      ["an HTTP error", { ok: false, body: {} }],
      ["a malformed body", { body: undefined }],
    ];
    for (const runtime of RUNTIME_MODES) {
      for (const [label, answer] of faults) {
        const fake = provider(answer);
        const result = await withRuntimeNodeEnv(runtime, () => production.verify({ token: "token" }, { env: CONFIGURED, fetcher: fake.fetcher }));
        // A body that is not an object is refused either way; never accepted.
        assert.equal(result.ok, false, `${label} / ${String(runtime)}`);
        if (label !== "a malformed body") assert.deepEqual(result, { ok: false, reason: "unavailable" }, label);
      }
    }
  });

  it("refuses as unavailable when the service does not answer before the deadline", async () => {
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 10);
    try {
      const fake = provider({ hang: true });
      const result = await withRuntimeNodeEnv(undefined, () => production.verify({ token: "token" }, { env: CONFIGURED, fetcher: fake.fetcher }));
      assert.deepEqual(result, { ok: false, reason: "unavailable" });
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  it("contains no development bypass and no runtime NODE_ENV check", () => {
    assert.ok(!/NODE_ENV/.test(production.code), "the production output consults NODE_ENV at runtime");
    assert.ok(!/bypassed:!0/.test(production.code), "the production output can still answer bypassed: true");
    // Positive control: the same source compiled for development keeps the bypass.
    assert.match(development.code, /bypassed: true/);
  });
});

describe("Turnstile outside a production build", () => {
  it("bypasses in a development build only when both keys are absent", async () => {
    await withRuntimeNodeEnv(undefined, async () => {
      const fake = provider({ body: success() });
      assert.deepEqual(await development.verify({ token: "" }, { env: {}, fetcher: fake.fetcher }), { ok: true, bypassed: true });
      assert.equal(fake.calls.length, 0);
      // A half-configured environment never bypasses.
      assert.deepEqual(await development.verify({ token: "" }, { env: { TURNSTILE_SITE_KEY: SITE } }), { ok: false, reason: "misconfigured" });
      // A configured one verifies for real.
      assert.deepEqual(await development.verify({ token: "token" }, { env: CONFIGURED, fetcher: provider({ body: success() }).fetcher }), { ok: true, bypassed: false });
    });
  });

  // tsx leaves process.env.NODE_ENV in place, the same as any uncompiled server.
  it("uncompiled, bypasses only when the runtime is explicitly development or test", async () => {
    const { verifyTurnstile } = await import("@/server/security/turnstile");
    for (const runtime of ["development", "test"]) {
      const result = await withRuntimeNodeEnv(runtime, () => verifyTurnstile({ token: "" }, { env: {} }));
      assert.deepEqual(result, { ok: true, bypassed: true }, runtime);
    }
    const { result } = await capturingErrors(() => Promise.all([undefined, "", "production", "staging"].map((runtime) =>
      withRuntimeNodeEnv(runtime, () => verifyTurnstile({ token: "" }, { env: {} })))));
    for (const refused of result) assert.deepEqual(refused, { ok: false, reason: "misconfigured" });
  });
});

describe("the inquiry workflow with a production-built verifier", () => {
  const form = () => {
    const data = new FormData();
    const fields: Record<string, string> = {
      submissionToken: "22222222-2222-4222-8222-222222222222", website: "", name: "Sentinel Visitor", email: "visitor@example.test",
      phone: "", whatsapp: "", company: "", projectType: "Photography", projectDate: "", location: "", budgetLabel: "",
      serviceSlug: "", referralSource: "", message: "A sentinel message describing the project.", [TURNSTILE_RESPONSE_FIELD]: "",
    };
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  function harness(isIntakeOpen: boolean, env: Record<string, string | undefined>) {
    const calls: string[] = [];
    const results: TurnstileResult[] = [];
    const dependencies: SubmitInquiryDependencies = {
      isIntakeOpen: () => isIntakeOpen,
      findReplay: async () => { calls.push("replay"); return null; },
      getTrustedClientIp: async () => undefined,
      consumeLimit: async () => { calls.push("limit"); return { allowed: true, configured: true }; },
      // The real production-compiled verifier, as contact/actions.ts binds it.
      verifyTurnstile: async (input) => {
        calls.push("turnstile");
        const result = await production.verify(input, { env, fetcher: provider({ body: success() }).fetcher });
        results.push(result);
        return result;
      },
      createInquiry: async () => { calls.push("create"); return { id: "33333333-3333-4333-8333-333333333333", duplicate: false }; },
      deliverEmails: async () => { calls.push("deliver"); return []; },
      logFailure: () => undefined,
    };
    return { calls, results, dependencies };
  }

  it("stops at the closed intake gate before Turnstile is consulted", async () => {
    const h = harness(false, {});
    const result = await withRuntimeNodeEnv(undefined, () => submitInquiryWorkflow(form(), h.dependencies));
    assert.deepEqual(result, { success: false, message: emptyStates.inquiry });
    assert.deepEqual(h.calls, []);
  });

  it("would refuse an unchallenged inquiry even if intake opened without Turnstile configured", async () => {
    const h = harness(true, {});
    const { result } = await capturingErrors(() => withRuntimeNodeEnv(undefined, () => submitInquiryWorkflow(form(), h.dependencies)));
    assert.deepEqual(result, { success: false, message: "Verification failed. Please try again." });
    assert.deepEqual(h.results, [{ ok: false, reason: "misconfigured" }]);
    assert.ok(!h.calls.includes("create"), "nothing persisted");
  });

  it("keeps the real gate bound in the public action", () => {
    // The gate's own closed state is asserted in draft-status.render-test.ts,
    // because legal content cannot be loaded under react-server conditions.
    assert.match(readFileSync("src/app/(public)/contact/actions.ts", "utf8"), /isIntakeOpen: \(\) => isInquiryIntakeOpen\(\)/);
    assert.match(readFileSync("src/app/(public)/contact/actions.ts", "utf8"), /verifyTurnstile: \(input\) => verifyTurnstile\(input\)/);
  });
});

/**
 * The real `next build` output. `npm run test:bundle` builds one offline and
 * sets PRODUCTION_BUNDLE_DIR, and then this must run. Without it, `npm test`
 * uses `.next` only when a build newer than turnstile.ts is on disk, and
 * otherwise skips rather than trusting a stale bundle.
 */
describe("the compiled Next.js server bundle", () => {
  const bundleDir = process.env.PRODUCTION_BUNDLE_DIR;
  const nextDir = bundleDir ?? ".next";
  const buildId = join(nextDir, "BUILD_ID");
  const fresh = bundleDir !== undefined || (existsSync(buildId) && statSync(buildId).mtimeMs > statSync("src/server/security/turnstile.ts").mtimeMs);
  const options = fresh ? {} : { skip: "no production build newer than turnstile.ts" };

  function serverFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return serverFiles(path);
      return /\.(js|mjs|cjs)$/.test(entry.name) ? [path] : [];
    });
  }

  it("contains Turnstile verification without the development bypass", options, () => {
    const withVerifier = serverFiles(join(nextDir, "server")).filter((file) => readFileSync(file, "utf8").includes("turnstile/v0/siteverify"));
    assert.ok(withVerifier.length > 0, "positive control: the verifier is in the bundle");
    for (const file of withVerifier) assert.ok(!/bypassed:!0/.test(readFileSync(file, "utf8")), file);
  });
});
