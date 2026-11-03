import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

/**
 * Server-side Sentry initialization as a production build sees it (DEF-02).
 *
 * Setting process.env.NODE_ENV in a test only shows runtime behaviour. The
 * defect was that the production server bundle consulted the runtime value at
 * all, so these tests compile the real `src/sentry.server.config.ts`,
 * `src/instrumentation.ts`, `src/instrumentation-client.ts`, and
 * `src/lib/monitoring/report.ts` the way `next build` does: `process.env.NODE_ENV`
 * is replaced, `NEXT_RUNTIME` is defined per runtime, and `process.env.NEXT_PUBLIC_*`
 * literals are inlined, as Next.js does in both server and browser bundles.
 *
 * Only `@sentry/nextjs` is replaced. The stub records what `init` receives and,
 * like the real SDK, captures nothing until a client exists. No event is sent
 * anywhere. esbuild ships with tsx, so this adds no dependency.
 */

type SentryState = { inits: Array<Record<string, unknown>>; client: boolean; events: Array<[string, string]> };
const sentry = globalThis as typeof globalThis & { __sentry: SentryState };

const SENTRY_STUB = `
  const s = () => globalThis.__sentry;
  export function init(options) { s().inits.push(options); s().client = true; }
  export function captureRequestError(error) { if (s().client) s().events.push(["server", error.digest ?? error.message]); }
  export function captureException(error) { if (s().client) s().events.push(["browser", error.digest ?? error.message]); }
`;

const RUNTIME_DSN = "https://runtimekey@o0.ingest.sentry.io/123";
const BUILD_DSN = "https://buildkey@o9.ingest.sentry.io/999";
/** Every runtime value a deployed function might see, including none at all. */
const RUNTIME_MODES = [undefined, "", "production", "development", "test", "staging"];

let outDir: string;
let loads = 0;

type Mode = "production" | "development";
type BuildOptions = { mode: Mode; runtime: "nodejs" | "browser"; publicEnv?: Record<string, string> };

async function compile(entry: string, { mode, runtime, publicEnv = {} }: BuildOptions): Promise<string> {
  const { build } = await import("esbuild");
  const define: Record<string, string> = { "process.env.NODE_ENV": JSON.stringify(mode) };
  if (runtime === "nodejs") define["process.env.NEXT_RUNTIME"] = JSON.stringify("nodejs");
  for (const [name, value] of Object.entries(publicEnv)) define[`process.env.${name}`] = JSON.stringify(value);
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: mode === "production",
    tsconfig: "tsconfig.json",
    define,
    logLevel: "silent",
    plugins: [
      {
        name: "sentry-stub",
        setup(builder) {
          builder.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({ path: "sentry", namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: SENTRY_STUB, loader: "js" }));
        },
      },
    ],
  });
  const file = join(outDir, `${entry.replace(/[^a-z0-9]+/gi, "-")}-${mode}-${loads++}.mjs`);
  writeFileSync(file, result.outputFiles[0]!.text);
  return file;
}

/** Imports a compiled module afresh, so its top-level `Sentry.init` decision runs again. */
const run = async <T = Record<string, unknown>>(file: string) => (await import(`${pathToFileURL(file).href}?run=${loads++}`)) as T;

/** Runs `body` with the given runtime variables set, or removed when undefined, then restores them. */
async function withRuntimeEnv<T>(values: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

const label = (runtime: string | undefined) => (runtime === undefined ? "unset" : runtime === "" ? "empty" : runtime);

let productionServer: string;
let developmentServer: string;

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), "sentry-server-build-"));
  productionServer = await compile("src/sentry.server.config.ts", { mode: "production", runtime: "nodejs" });
  developmentServer = await compile("src/sentry.server.config.ts", { mode: "development", runtime: "nodejs" });
});

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

beforeEach(() => {
  sentry.__sentry = { inits: [], client: false, events: [] };
});

describe("server Sentry in a production build", () => {
  for (const runtime of RUNTIME_MODES) {
    it(`initializes with a valid DSN when the runtime NODE_ENV is ${label(runtime)}`, async () => {
      await withRuntimeEnv({ NODE_ENV: runtime, NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN }, () => run(productionServer));
      assert.equal(sentry.__sentry.inits.length, 1);
      assert.equal(sentry.__sentry.inits[0]!.dsn, RUNTIME_DSN);
    });
  }

  it("stays off without a DSN, whatever the runtime NODE_ENV", async () => {
    for (const runtime of RUNTIME_MODES) {
      await withRuntimeEnv({ NODE_ENV: runtime, NEXT_PUBLIC_SENTRY_DSN: undefined }, () => run(productionServer));
    }
    await withRuntimeEnv({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "   " }, () => run(productionServer));
    assert.deepEqual(sentry.__sentry.inits, []);
  });

  it("stays off with a malformed DSN", async () => {
    for (const dsn of ["http://key@o0.ingest.sentry.io/123", "https://o0.ingest.sentry.io/123", "https://key@o0.ingest.sentry.io/project", "not a url"]) {
      await withRuntimeEnv({ NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: dsn }, () => run(productionServer));
    }
    assert.deepEqual(sentry.__sentry.inits, []);
  });

  it("overrides the runtime NODE_ENV with the build-time constant", async () => {
    // The literal is replaced in the production build, and the constant is
    // spread after the runtime environment, so no deployment value can win.
    const { readFileSync } = await import("node:fs");
    const code = readFileSync(productionServer, "utf8");
    assert.match(code, /\{\.\.\.process\.env,NODE_ENV:"production"\}/);
    assert.ok(!code.includes("process.env.NODE_ENV"), "no runtime read of process.env.NODE_ENV remains");
  });
});

describe("server Sentry outside a production build", () => {
  it("stays off in a development build even with a DSN and a runtime claim of production", async () => {
    for (const runtime of [undefined, "production"]) {
      await withRuntimeEnv({ NODE_ENV: runtime, NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN }, () => run(developmentServer));
    }
    assert.deepEqual(sentry.__sentry.inits, []);
  });
});

describe("runtime-controlled server configuration", () => {
  it("reads the DSN, environment, and release from the runtime, not values inlined at build", async () => {
    // Next.js inlines process.env.NEXT_PUBLIC_* literals in server bundles too.
    // The server config must not use them, or the DSN would freeze at build.
    const built = await compile("src/sentry.server.config.ts", {
      mode: "production",
      runtime: "nodejs",
      publicEnv: { NEXT_PUBLIC_SENTRY_DSN: BUILD_DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "build-env", NEXT_PUBLIC_SENTRY_RELEASE: "build-release" },
    });
    await withRuntimeEnv(
      { NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "runtime-env", NEXT_PUBLIC_SENTRY_RELEASE: "runtime-release" },
      () => run(built),
    );
    assert.equal(sentry.__sentry.inits.length, 1);
    const options = sentry.__sentry.inits[0]!;
    assert.equal(options.dsn, RUNTIME_DSN);
    assert.equal(options.environment, "runtime-env");
    assert.equal(options.release, "runtime-release");

    // Removing the DSN at runtime turns server reporting off, even though a DSN existed at build.
    sentry.__sentry = { inits: [], client: false, events: [] };
    await withRuntimeEnv({ NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined }, () => run(built));
    assert.deepEqual(sentry.__sentry.inits, []);
  });

  it("labels the environment 'production' by default", async () => {
    await withRuntimeEnv({ NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: undefined, NEXT_PUBLIC_SENTRY_RELEASE: undefined }, () => run(productionServer));
    assert.equal(sentry.__sentry.inits[0]!.environment, "production");
    assert.equal("release" in sentry.__sentry.inits[0]!, false);
  });
});

describe("server and browser receive the same privacy options", () => {
  it("matches on every data-collection, transport, and integration decision", async () => {
    const env = { NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "preview", NEXT_PUBLIC_SENTRY_RELEASE: "r1" };
    await withRuntimeEnv({ NODE_ENV: undefined, ...env }, () => run(productionServer));
    const browser = await compile("src/instrumentation-client.ts", { mode: "production", runtime: "browser", publicEnv: env });
    await withRuntimeEnv({ NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined }, () => run(browser));
    assert.equal(sentry.__sentry.inits.length, 2, "both runtimes initialized");
    const [server, client] = sentry.__sentry.inits as [Record<string, unknown>, Record<string, unknown>];

    const data = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v !== "function"));
    assert.deepEqual(data(server), data(client));
    assert.deepEqual(Object.keys(server).sort(), Object.keys(client).sort());
    assert.equal("tracesSampleRate" in server || "tracesSampler" in server, false, "no tracing is enabled");

    const defaults = ["BrowserTracing", "BrowserSession", "ProcessSession", "Console", "LocalVariables", "LocalVariablesAsync", "InboundFilters", "Http"].map((name) => ({ name }));
    const integrations = (o: Record<string, unknown>) => (o.integrations as (d: typeof defaults) => typeof defaults)(defaults).map((i) => i.name);
    assert.deepEqual(integrations(server), ["InboundFilters", "Http"]);
    assert.deepEqual(integrations(server), integrations(client));

    const event = () => ({
      message: "failed for visitor@example.test",
      user: { id: "u1", ip_address: "203.0.113.1" },
      request: { url: "https://example.test/contact?email=visitor@example.test", headers: { cookie: "session=secret" }, cookies: { session: "secret" }, data: "body" },
    });
    const send = (o: Record<string, unknown>) => (o.beforeSend as (e: unknown) => unknown)(event());
    assert.deepEqual(send(server), send(client));
    const scrubbed = JSON.stringify(send(server));
    for (const secret of ["visitor@example.test", "203.0.113.1", "session=secret", "\"secret\""]) assert.ok(!scrubbed.includes(secret), secret);

    assert.equal((server.beforeSendTransaction as () => unknown)(), null);
    assert.equal((client.beforeSendTransaction as () => unknown)(), null);
  });
});

describe("one report per server error (digest handling)", () => {
  async function scenario() {
    const instrumentation = await compile("src/instrumentation.ts", { mode: "production", runtime: "nodejs" });
    const report = await compile("src/lib/monitoring/report.ts", { mode: "production", runtime: "browser" });
    return {
      server: await run<{ register: () => Promise<void>; onRequestError: (error: Error) => void }>(instrumentation),
      browser: await run<{ reportBoundaryError: (error: Error & { digest?: string }, boundary: string) => void }>(report),
    };
  }

  it("reports a server error once, from the server, with no runtime NODE_ENV", async () => {
    const { server, browser } = await scenario();
    await withRuntimeEnv({ NODE_ENV: undefined, NEXT_PUBLIC_SENTRY_DSN: RUNTIME_DSN }, () => server.register());
    assert.equal(sentry.__sentry.inits.length, 1, "register() initialized the Node runtime");

    const thrown = Object.assign(new Error("server failure"), { digest: "d-123" });
    server.onRequestError(thrown);
    // Next.js re-renders the boundary in the browser with the digest only.
    browser.reportBoundaryError(Object.assign(new Error("redacted"), { digest: "d-123" }), "public");
    assert.deepEqual(sentry.__sentry.events, [["server", "d-123"]]);
  });

  it("reports a browser-only error once, from the browser", async () => {
    const { browser } = await scenario();
    sentry.__sentry.client = true;
    browser.reportBoundaryError(new Error("client failure"), "admin");
    assert.deepEqual(sentry.__sentry.events, [["browser", "client failure"]]);
  });

  it("documents the dependency: if the server never initializes, the browser does not fill the gap", async () => {
    // OBS-01. The browser deliberately skips digest errors, so server
    // reporting is the only path for them. Simulated here by not calling init.
    const { server, browser } = await scenario();
    server.onRequestError(Object.assign(new Error("server failure"), { digest: "d-456" }));
    sentry.__sentry.client = true; // the browser has its own client
    browser.reportBoundaryError(Object.assign(new Error("redacted"), { digest: "d-456" }), "public");
    assert.deepEqual(sentry.__sentry.events, [], "the error is reported nowhere");
  });
});
