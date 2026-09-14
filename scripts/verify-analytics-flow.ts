import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_UMAMI_SCRIPT_URL,
  resolveUmamiConfig,
  UMAMI_SCRIPT_ID,
} from "@/lib/analytics/umami";
import { monitoringDsn, sentryIngestOrigin } from "@/lib/monitoring/dsn";
import { sentryInitOptions } from "@/lib/monitoring/options";
import { scrubBreadcrumb, scrubEvent, scrubText } from "@/lib/monitoring/scrub";
import { securityHeaders } from "@/lib/security-headers";

/**
 * Verification of analytics and error monitoring.
 *
 * Offline: both integrations are configured entirely from environment
 * variables, so their whole decision surface is a pure function of an
 * environment record. No Sentry account, DSN, or network is needed.
 *
 * Sentry's wire protocol belongs to `@sentry/nextjs` and is not re-verified
 * here. What is verified is every place this application deliberately narrows
 * the SDK's defaults, because those are the decisions an SDK upgrade could
 * silently reverse — plus the two quiet failure modes that matter: a tracker
 * loading twice, and a payload carrying personal data.
 *
 *   npm run analytics:verify
 */

const UMAMI_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const DSN = "https://abc123def456@o4507.ingest.sentry.io/4507";
const PRODUCTION = { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: DSN };

function section(name: string): void {
  console.log(`  ${name}`);
}

/** Every source file under src/, for repository-wide assertions. */
async function sourceFiles(directory = "src"): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        // Generated Prisma output is not reviewed source.
        return entry.name === "generated" ? [] : sourceFiles(path);
      }

      return /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );

  return nested.flat();
}

function verifyUmamiDisabled(): void {
  section("umami disabled");

  assert.equal(resolveUmamiConfig({}), null, "no configuration means no analytics");
  assert.equal(
    resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: "   " }),
    null,
    "a blank website id is not configuration",
  );
  assert.equal(
    resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://umami.example/s.js" }),
    null,
    "a script URL without a website id measures nothing",
  );
  assert.equal(
    resolveUmamiConfig({
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: "not a url",
    }),
    null,
    "a malformed script URL disables analytics rather than emitting a broken tag",
  );
  assert.equal(
    resolveUmamiConfig({
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: "http://umami.example/script.js",
    }),
    null,
    "a plaintext tracker is refused",
  );

  const csp = securityHeaders({}).find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
  assert.ok(
    !csp.includes("umami"),
    "an unconfigured deployment names no analytics origin in its CSP",
  );
}

function verifyUmamiEnabled(): void {
  section("umami enabled");

  const fromPublic = resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID });
  assert.equal(fromPublic?.websiteId, UMAMI_ID);
  assert.equal(fromPublic?.scriptUrl, DEFAULT_UMAMI_SCRIPT_URL);
  assert.equal(fromPublic?.scriptOrigin, "https://cloud.umami.is");

  const fromAlias = resolveUmamiConfig({ UMAMI_WEBSITE_ID: UMAMI_ID });
  assert.deepEqual(fromAlias, fromPublic, "the unprefixed alias is equivalent");

  const selfHosted = resolveUmamiConfig({
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://analytics.studio.example/script.js",
  });
  assert.equal(selfHosted?.scriptOrigin, "https://analytics.studio.example");

  const csp = securityHeaders({
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://analytics.studio.example/script.js",
  }).find((header) => header.key === "Content-Security-Policy")!.value;

  const scriptSrc = csp.split("; ").find((part) => part.startsWith("script-src"))!;
  const connectSrc = csp.split("; ").find((part) => part.startsWith("connect-src"))!;

  assert.ok(
    scriptSrc.includes("https://analytics.studio.example"),
    "the tracker may load",
  );
  assert.ok(
    connectSrc.includes("https://analytics.studio.example"),
    "the tracker may report",
  );
  assert.ok(
    scriptSrc.includes("'self'") && scriptSrc.includes("challenges.cloudflare.com"),
    "the Phase 8 policy is widened, not replaced",
  );
  assert.ok(!csp.includes("*"), "no wildcard is introduced");
}

async function verifyNoDuplicateTracker(): Promise<void> {
  section("duplicate script prevention");

  const files = await sourceFiles();
  const mounts: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");

    if (file.endsWith("umami-analytics.tsx")) {
      assert.ok(
        source.includes(`id={UMAMI_SCRIPT_ID}`),
        "the tracker carries the stable id Next.js deduplicates by",
      );
      assert.ok(
        source.includes("if (!config) return null"),
        "an unconfigured deployment renders nothing",
      );
      continue;
    }

    if (source.includes("<UmamiAnalytics")) mounts.push(file);
  }

  assert.deepEqual(
    mounts,
    [join("src", "app", "(public)", "layout.tsx")],
    "the tracker is mounted exactly once, in the public layout",
  );
  assert.equal(UMAMI_SCRIPT_ID, "umami-analytics", "the id is stable");

  // The admin area is a private workspace whose URLs carry record identifiers.
  const adminLayout = await readFile(
    join("src", "app", "(admin)", "admin", "layout.tsx"),
    "utf8",
  );
  assert.ok(
    !adminLayout.includes("Umami"),
    "the private workspace is never measured",
  );

  // Cookieless: nothing in this repository writes an analytics cookie.
  for (const file of files.filter((path) => path.includes(join("lib", "analytics")))) {
    const source = await readFile(file, "utf8");
    assert.ok(
      !/document\.cookie|setCookie|cookies\(\)/.test(source),
      `${file} sets no cookie`,
    );
  }
}

function verifyMonitoringDisabled(): void {
  section("sentry disabled");

  assert.equal(sentryInitOptions({}), null, "nothing configured, nothing runs");
  assert.equal(
    sentryInitOptions({ NODE_ENV: "development", NEXT_PUBLIC_SENTRY_DSN: DSN }),
    null,
    "development never reports -- a local stack trace belongs in the terminal",
  );
  assert.equal(
    sentryInitOptions({ NODE_ENV: "production" }),
    null,
    "production without a DSN reports nothing and warns about nothing",
  );

  for (const malformed of [
    "not a dsn",
    "https://o4507.ingest.sentry.io/4507",
    "https://key@o4507.ingest.sentry.io/not-a-project",
  ]) {
    assert.equal(
      monitoringDsn({ NEXT_PUBLIC_SENTRY_DSN: malformed }),
      null,
      `a malformed DSN is unconfigured, not half-configured: ${malformed}`,
    );
  }

  const csp = securityHeaders({}).find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
  assert.equal(
    csp.split("; ").find((part) => part.startsWith("connect-src")),
    "connect-src 'self' https://challenges.cloudflare.com",
    "with monitoring off, the policy is the Phase 8 policy",
  );
}

function verifyMonitoringEnabled(): void {
  section("sentry enabled");

  const options = sentryInitOptions(PRODUCTION)!;

  assert.equal(options.dsn, DSN);
  assert.equal(options.environment, "production");
  assert.equal(
    sentryInitOptions({
      ...PRODUCTION,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "staging",
      NEXT_PUBLIC_SENTRY_RELEASE: "abc1234",
    })!.environment,
    "staging",
  );

  section("tracing, sessions and replay are off");

  assert.equal("tracesSampleRate" in options, false, "no tracing sample rate");
  assert.equal("tracesSampler" in options, false, "no tracing sampler");
  assert.equal(options.beforeSendTransaction(), null, "transactions are refused");
  assert.deepEqual(
    options
      .integrations([
        { name: "BrowserTracing" },
        { name: "BrowserSession" },
        { name: "ProcessSession" },
        { name: "Console" },
        { name: "LocalVariablesAsync" },
        { name: "GlobalHandlers" },
      ])
      .map((integration) => integration.name),
    ["GlobalHandlers"],
    "error capture stays; tracing, sessions, console and local variables go",
  );

  const serializedOptions = JSON.stringify(options).toLowerCase();
  assert.ok(!serializedOptions.includes("replay"), "Session Replay is never added");
  assert.ok(!serializedOptions.includes("profil"), "profiling is never added");

  section("no personal data leaves the process");

  assert.deepEqual(
    options.dataCollection,
    {
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
    },
    "every collection switch is stated explicitly and set to its narrowest value",
  );

  // Defence in depth: even if the SDK's collection defaults changed, the
  // outgoing event is stripped.
  const scrubbed = scrubEvent({
    type: undefined,
    message: "Unique constraint failed for visitor@example.com",
    user: { id: "customer-1", ip_address: "203.0.113.4" },
    request: {
      url: "https://studio.example/contact?email=visitor%40example.com",
      cookies: { "better-auth.session_token": "a-session" },
      headers: { cookie: "session=a-session", authorization: "Bearer abc" },
      data: { message: "A private inquiry message.", phone: "+49 30 1234567" },
      query_string: "email=visitor%40example.com",
    },
    exception: {
      values: [
        {
          type: "PrismaClientKnownRequestError",
          value:
            "Failed for visitor@example.com on +49 30 1234567 at " +
            "postgres://user:hunter2@db.example/app?sslmode=require",
        },
      ],
    },
    contexts: { nextjs: { request_path: "/contact?token=abc123def" } },
  });
  const serialized = JSON.stringify(scrubbed);

  for (const secret of [
    "visitor@example.com",
    "hunter2",
    "sslmode",
    "1234567",
    "better-auth",
    "Bearer",
    "A private inquiry message",
    "203.0.113.4",
    "customer-1",
    "abc123def",
  ]) {
    assert.ok(!serialized.includes(secret), `the event still carries ${secret}`);
  }

  assert.equal(scrubbed.user, undefined, "nobody is identified");
  assert.equal(scrubbed.request?.cookies, undefined, "no session cookie");
  assert.equal(scrubbed.request?.headers, undefined, "no Authorization header");
  assert.equal(scrubbed.request?.data, undefined, "no inquiry body");
  assert.equal(scrubbed.request?.url, "https://studio.example/contact");

  assert.equal(
    scrubBreadcrumb({ category: "console", message: "inquiry from a@b.example" }),
    null,
    "console breadcrumbs are dropped: this application logs what it works with",
  );
  assert.equal(scrubText("plain failure"), "plain failure", "scrubbing is targeted");

  section("content security policy");

  const csp = securityHeaders(PRODUCTION).find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
  const connectSrc = csp.split("; ").find((part) => part.startsWith("connect-src"))!;

  assert.equal(
    sentryIngestOrigin(DSN),
    "https://o4507.ingest.sentry.io",
    "the origin the browser SDK transport posts to",
  );
  assert.ok(
    connectSrc.endsWith(" https://o4507.ingest.sentry.io"),
    "exactly one origin is appended for browser reporting",
  );
  assert.ok(
    !csp.split("; ").find((part) => part.startsWith("script-src"))!.includes("sentry"),
    "the SDK is bundled, not fetched from Sentry, so no script origin is needed",
  );
  assert.ok(!csp.includes("*"), "no wildcard is introduced");
}

async function verifyWiring(): Promise<void> {
  section("sdk wiring");

  const instrumentation = await readFile("src/instrumentation.ts", "utf8");
  assert.ok(
    instrumentation.includes("Sentry.captureRequestError"),
    "server errors are reported through the framework's onRequestError hook",
  );
  assert.ok(
    instrumentation.includes("./sentry.server.config") &&
      instrumentation.includes("./sentry.edge.config"),
    "both server runtimes are initialized",
  );

  const client = await readFile("src/instrumentation-client.ts", "utf8");
  assert.ok(
    !/^export .*onRouterTransitionStart/m.test(client),
    "no navigation tracing hook is exported while tracing is off",
  );

  for (const file of [
    "src/sentry.server.config.ts",
    "src/sentry.edge.config.ts",
    "src/instrumentation-client.ts",
  ]) {
    const source = await readFile(file, "utf8");

    assert.ok(
      source.includes("sentryInitOptions"),
      `${file} uses the one shared option set`,
    );
    assert.ok(
      source.includes("if (options)"),
      `${file} skips Sentry.init entirely when monitoring is disabled`,
    );
  }

  // Double-report avoidance: a server error is captured by onRequestError, and
  // Next.js re-renders the boundary with a digest-only placeholder.
  const wrapper = await readFile("src/lib/monitoring/report.ts", "utf8");
  assert.ok(
    wrapper.includes("if (error.digest) return;"),
    "a server error already reported by onRequestError is not reported again",
  );

  for (const boundary of [
    "src/app/global-error.tsx",
    "src/app/(public)/error.tsx",
  ]) {
    const source = await readFile(boundary, "utf8");
    assert.ok(
      source.includes("reportBoundaryError"),
      `${boundary} reports through the shared wrapper`,
    );
  }

  const config = await readFile("next.config.ts", "utf8");
  assert.ok(config.includes("withSentryConfig"), "the build integration is applied");
  assert.ok(
    config.includes("disable: !process.env.SENTRY_AUTH_TOKEN"),
    "a build without an auth token attempts no source-map upload",
  );
  assert.ok(
    config.includes("deleteSourcemapsAfterUpload: true"),
    "uploaded source maps are not also published with the site",
  );

  // The auth token is build-time only and must never reach the browser.
  const files = await sourceFiles();

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(
      !source.includes("SENTRY_AUTH_TOKEN"),
      `${file} must not reference the build-time auth token`,
    );
  }
}

async function main(): Promise<void> {
  console.log("Verifying analytics and monitoring:");

  verifyUmamiDisabled();
  verifyUmamiEnabled();
  await verifyNoDuplicateTracker();
  verifyMonitoringDisabled();
  verifyMonitoringEnabled();
  await verifyWiring();

  console.log(
    "Analytics and monitoring verification passed: silently disabled without " +
      "configuration, a single cookieless tracker when enabled, the official " +
      "Sentry SDK confined to production with tracing, sessions and replay off, " +
      "every collection switch at its narrowest value, a Content-Security-Policy " +
      "widened only for the origins actually configured, and no personal data in " +
      "an outgoing event.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Analytics verification failed",
  );
  process.exitCode = 1;
});
