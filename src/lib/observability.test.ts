import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveUmamiConfig, UMAMI_SCRIPT_ID } from "@/lib/analytics/umami";
import { monitoringDsn, sentryIngestOrigin } from "@/lib/monitoring/dsn";
import {
  DISABLED_INTEGRATIONS,
  filterIntegrations,
  resolveMonitoringConfig,
  sentryInitOptions,
} from "@/lib/monitoring/options";
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from "@/lib/monitoring/scrub";
import { securityHeaders } from "@/lib/security-headers";

/**
 * Phase 9 analytics and monitoring rules.
 *
 * These assert the configuration handed to `@sentry/nextjs`, not a transport of
 * our own — the SDK owns the protocol. What is worth asserting is every place
 * we deliberately narrow the SDK's defaults, because those are the decisions a
 * dependency upgrade could silently reverse: what it is allowed to collect,
 * which integrations are removed, and that nothing runs at all until a DSN is
 * configured in production.
 *
 * Nothing here needs a Sentry account, a DSN, or a network.
 */

const UMAMI_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const DSN = "https://abc123@o4507.ingest.sentry.io/4507";
const PRODUCTION = { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: DSN };

function directive(csp: string, name: string): string {
  return csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

function cspFor(env: Record<string, string | undefined>): string {
  return securityHeaders(env).find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
}

describe("umami", () => {
  it("is disabled unless a website id is configured", () => {
    assert.equal(resolveUmamiConfig({}), null);
    assert.equal(resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: "  " }), null);
    assert.equal(
      resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://u.example/s.js" }),
      null,
    );
  });

  it("refuses a tracker URL it cannot trust", () => {
    assert.equal(
      resolveUmamiConfig({
        NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
        NEXT_PUBLIC_UMAMI_SCRIPT_URL: "http://u.example/script.js",
      }),
      null,
    );
    assert.equal(
      resolveUmamiConfig({
        NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
        NEXT_PUBLIC_UMAMI_SCRIPT_URL: "nonsense",
      }),
      null,
    );
  });

  it("accepts either spelling of the website id", () => {
    assert.deepEqual(
      resolveUmamiConfig({ UMAMI_WEBSITE_ID: UMAMI_ID }),
      resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID }),
    );
    assert.equal(UMAMI_SCRIPT_ID, "umami-analytics");
  });
});

describe("A. Sentry disabled", () => {
  it("produces no init options, so Sentry.init is never called", () => {
    assert.equal(sentryInitOptions({}), null, "nothing configured");
    assert.equal(
      sentryInitOptions({ NODE_ENV: "development", NEXT_PUBLIC_SENTRY_DSN: DSN }),
      null,
      "a DSN in development still initializes nothing",
    );
    assert.equal(
      sentryInitOptions({ NODE_ENV: "production" }),
      null,
      "production without a DSN initializes nothing and warns about nothing",
    );
    assert.equal(resolveMonitoringConfig({ NODE_ENV: "production" }), null);
  });
});

describe("B. malformed DSN", () => {
  it("is treated as unconfigured rather than half-configured", () => {
    for (const value of [
      "",
      "   ",
      "not a dsn",
      "https://o4507.ingest.sentry.io/4507", // no public key
      "https://@o4507.ingest.sentry.io/4507", // empty public key
      "https://abc123@o4507.ingest.sentry.io/not-a-project", // no project id
      "https://abc123@o4507.ingest.sentry.io/", // no project id at all
      "https://abc123@o4507.ingest.sentry.io/org/4507", // not a DSN path
      "ftp://abc123@o4507.ingest.sentry.io/4507", // unusable scheme
      "javascript:alert(1)//abc@h/1", // script scheme
      "data:text/html;base64,abcd", // data scheme
      "//abc123@o4507.ingest.sentry.io/4507", // protocol-relative
      // Plaintext: it would put an http:// origin into connect-src that
      // production's upgrade-insecure-requests then refuses to honour.
      "http://abc123@o4507.ingest.sentry.io/4507",
    ]) {
      assert.equal(
        monitoringDsn({ NEXT_PUBLIC_SENTRY_DSN: value }),
        null,
        `${value || "(blank)"} must not enable monitoring`,
      );
      assert.equal(
        sentryInitOptions({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: value }),
        null,
      );
      assert.equal(
        cspFor({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: value }).includes(
          "sentry",
        ),
        false,
        "a malformed DSN never reaches the policy",
      );
    }
  });
});

describe("C/D. initialization when configured", () => {
  it("builds one option set shared by the browser, Node, and Edge runtimes", () => {
    const options = sentryInitOptions(PRODUCTION)!;

    assert.equal(options.dsn, DSN);
    assert.equal(options.environment, "production");
    assert.equal("release" in options, false, "no release unless configured");

    // The client reads the same variables through explicitly named lookups;
    // the resulting configuration must be identical to the server's.
    assert.deepEqual(
      Object.keys(sentryInitOptions({ ...PRODUCTION })!).sort(),
      Object.keys(options).sort(),
    );
  });

  it("labels the environment and release when configured", () => {
    const options = sentryInitOptions({
      ...PRODUCTION,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "staging",
      NEXT_PUBLIC_SENTRY_RELEASE: "abc1234",
    })!;

    assert.equal(options.environment, "staging");
    assert.equal(options.release, "abc1234");
  });
});

describe("E. privacy configuration", () => {
  const options = sentryInitOptions(PRODUCTION)!;

  it("forbids every structured carrier of personal data", () => {
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
  });

  it("states every field, because a partial object collects more, not less", () => {
    // In SDK v10, supplying `dataCollection` switches the fallback defaults to
    // the permissive set. An omitted field would therefore be collected.
    assert.deepEqual(
      Object.keys(options.dataCollection).sort(),
      [
        "cookies",
        "databaseQueryData",
        "frameContextLines",
        "genAI",
        "graphQL",
        "httpBodies",
        "httpHeaders",
        "stackFrameVariables",
        "urlQueryParams",
        "userInfo",
      ],
    );
  });

  it("scrubs free text on the way out", () => {
    assert.equal(scrubText("from visitor@example.com"), "from [redacted-email]");
    assert.equal(
      scrubText("postgres://user:pw@db.example/app"),
      "postgres://[redacted]@db.example/app",
    );
    assert.equal(scrubText("call +49 30 1234567"), "call [redacted-number]");
    assert.equal(scrubText("plain failure"), "plain failure");
    assert.equal(scrubUrl("https://studio.example/work?q=secret#x"), "https://studio.example/work");
  });

  it("strips the carriers from an event even if configuration changed", () => {
    const scrubbed = scrubEvent({
      type: undefined,
      message: "Failed for visitor@example.com",
      user: { id: "customer-1", ip_address: "203.0.113.4", email: "a@b.example" },
      request: {
        url: "https://studio.example/contact?email=visitor%40example.com",
        cookies: { "better-auth.session_token": "secret" },
        headers: { cookie: "session=secret", authorization: "Bearer abc" },
        data: { message: "A private inquiry message.", phone: "+49 30 1234567" },
        query_string: "email=visitor%40example.com",
      },
      exception: {
        values: [{ type: "Error", value: "Duplicate visitor@example.com" }],
      },
      contexts: { nextjs: { request_path: "/contact?token=abc123def" } },
    });

    const serialized = JSON.stringify(scrubbed);

    for (const secret of [
      "visitor@example.com",
      "better-auth",
      "Bearer",
      "A private inquiry message",
      "203.0.113.4",
      "customer-1",
      "abc123def",
    ]) {
      assert.ok(!serialized.includes(secret), `event still carries ${secret}`);
    }

    assert.equal(scrubbed.user, undefined);
    assert.equal(scrubbed.request?.cookies, undefined);
    assert.equal(scrubbed.request?.headers, undefined);
    assert.equal(scrubbed.request?.data, undefined);
    assert.equal(scrubbed.request?.url, "https://studio.example/contact");
  });

  it("drops console breadcrumbs and strips breadcrumb URLs", () => {
    assert.equal(
      scrubBreadcrumb({ category: "console", message: "inquiry from a@b.example" }),
      null,
      "this application logs the values it is working with",
    );

    const navigation = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/work?category=film", to: "/contact?email=a%40b.example" },
    });

    assert.deepEqual(navigation?.data, { from: "/work", to: "/contact" });
  });
});

describe("F. no user or customer context is attached", () => {
  it("never sets a user, and removes one another integration set", () => {
    const options = sentryInitOptions(PRODUCTION)!;

    assert.equal(options.dataCollection.userInfo, false, "no IP, no user id");
    assert.equal(
      scrubEvent({ type: undefined, user: { id: "u1" } }).user,
      undefined,
      "any user an integration attaches is removed before sending",
    );
    assert.ok(
      !JSON.stringify(options).includes("setUser"),
      "nothing in the configuration identifies anyone",
    );
  });
});

describe("G/H. tracing, session tracking, and replay", () => {
  const options = sentryInitOptions(PRODUCTION)!;

  it("enables no tracing", () => {
    assert.equal("tracesSampleRate" in options, false);
    assert.equal("tracesSampler" in options, false);
    assert.equal(
      options.beforeSendTransaction(),
      null,
      "a transaction is refused even if tracing were switched on",
    );
  });

  it("removes the tracing and session integrations from the defaults", () => {
    const defaults = [
      { name: "BrowserTracing" },
      { name: "BrowserSession" },
      { name: "ProcessSession" },
      { name: "Console" },
      { name: "LocalVariablesAsync" },
      { name: "GlobalHandlers" },
      { name: "LinkedErrors" },
    ];

    assert.deepEqual(
      options.integrations(defaults).map((integration) => integration.name),
      ["GlobalHandlers", "LinkedErrors"],
      "error capture stays; tracing, sessions, console and locals go",
    );
  });

  it("adds no replay or profiling integration", () => {
    const serialized = JSON.stringify(DISABLED_INTEGRATIONS);

    assert.ok(!JSON.stringify(options).includes("replay"));
    assert.ok(!JSON.stringify(options).includes("profil"));
    // Replay is absent because it is never added, not because it is filtered.
    assert.ok(!serialized.includes("Replay"));
    assert.deepEqual(filterIntegrations([{ name: "Replay" }]), [{ name: "Replay" }]);
  });
});

describe("I/J. content security policy", () => {
  it("stays Phase 8-compatible when nothing is configured", () => {
    const csp = cspFor({});

    assert.equal(directive(csp, "script-src").includes("umami"), false);
    assert.equal(directive(csp, "connect-src").includes("sentry"), false);
    assert.equal(
      directive(csp, "connect-src"),
      "connect-src 'self' https://challenges.cloudflare.com",
      "identical to the Phase 8 policy",
    );
    assert.ok(!csp.includes("*"));
  });

  it("accepts a self-hosted HTTPS DSN, port and credentials included", () => {
    // Validation is shape-based, not an allowlist: a self-hosted Sentry can be
    // any host, and this variable is operator-controlled, never visitor-facing.
    assert.equal(
      sentryIngestOrigin("https://key@sentry.studio.example:8443/7"),
      "https://sentry.studio.example:8443",
    );
    // The legacy DSN secret never reaches the policy: an origin has no userinfo.
    assert.equal(
      sentryIngestOrigin("https://key:legacysecret@o4507.ingest.sentry.io/4507"),
      "https://o4507.ingest.sentry.io",
    );
    assert.equal(
      sentryIngestOrigin("  https://key@o4507.ingest.sentry.io/4507  "),
      "https://o4507.ingest.sentry.io",
      "surrounding whitespace is tolerated",
    );
  });

  it("adds only the browser reporting origin when a DSN is configured", () => {
    const csp = cspFor(PRODUCTION);

    assert.equal(
      directive(csp, "connect-src"),
      `connect-src 'self' https://challenges.cloudflare.com ${sentryIngestOrigin(DSN)}`,
      "one origin, appended to the Phase 8 policy",
    );
    assert.equal(
      sentryIngestOrigin(DSN),
      "https://o4507.ingest.sentry.io",
      "the origin the browser transport posts to",
    );
    assert.ok(
      !directive(csp, "script-src").includes("sentry"),
      "the SDK is bundled, not loaded from Sentry, so no script origin is needed",
    );
    assert.ok(
      !directive(csp, "img-src").includes("sentry") &&
        !directive(csp, "frame-src").includes("sentry"),
      "connect-src is the only directive Sentry needs",
    );
    assert.ok(!csp.includes("*"));
  });

  it("widens both directives when analytics is configured too", () => {
    const csp = cspFor({
      ...PRODUCTION,
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: UMAMI_ID,
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://analytics.example/script.js",
    });

    assert.ok(directive(csp, "script-src").includes("https://analytics.example"));
    assert.ok(directive(csp, "connect-src").includes("https://analytics.example"));
    assert.ok(directive(csp, "connect-src").includes("https://o4507.ingest.sentry.io"));
    assert.ok(!csp.includes("*"));
  });
});
