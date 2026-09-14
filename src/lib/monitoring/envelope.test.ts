import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import * as Sentry from "@sentry/nextjs";

import { sentryInitOptions } from "@/lib/monitoring/options";

/**
 * What the real SDK actually sends.
 *
 * The other monitoring tests assert the *configuration* handed to
 * `@sentry/nextjs`. That is necessary but not sufficient, and the difference is
 * not academic: asserting `scrubEvent` against a hand-written event object only
 * proves the scrubber handles the fields the fixture happens to contain, and a
 * review found fields reaching the envelope that no fixture had.
 *
 * So this boots the actual SDK with the actual options, swaps in a capturing
 * transport, and pushes a realistic authenticated admin request error through
 * `Sentry.captureRequestError` — the same entry point `onRequestError` uses.
 * The assertions are on the bytes that would have gone over the wire.
 *
 * No DSN, account, or network: the transport never sends, and the DSN below is
 * a syntactically valid but non-existent project.
 */

const DSN = "https://abc123@o4507.ingest.sentry.io/4507";

/** Values that must never appear anywhere in an outgoing envelope. */
const SECRETS = {
  sessionCookie: "SESSIONSECRETVALUE",
  csrfCookie: "CSRFSECRETVALUE",
  bearer: "ADMINBEARERTOKENVALUE",
  turnstile: "TURNSTILETOKENVALUE",
  clientIp: "203.0.113.44",
  visitorEmail: "visitor@example.com",
  visitorPhone: "+49 30 1234567",
  userAgent: "ProbeAgent/1.0",
};

type Envelope = [unknown, [[unknown, Record<string, unknown>]]];

const captured: Envelope[] = [];

before(async () => {
  const options = sentryInitOptions({
    NODE_ENV: "production",
    NEXT_PUBLIC_SENTRY_DSN: DSN,
  })!;

  assert.ok(options, "the test needs monitoring to resolve as enabled");

  Sentry.init({
    ...options,
    transport: () => ({
      send: async (envelope: unknown) => {
        captured.push(envelope as Envelope);
        return {};
      },
      flush: async () => true,
    }),
  } as never);

  // The breadcrumbs the application would realistically have produced first.
  Sentry.addBreadcrumb({
    category: "console",
    message: `[public] Rendering failed: inquiry from ${SECRETS.visitorEmail}`,
  });
  Sentry.addBreadcrumb({
    category: "navigation",
    data: { from: "/work?category=film", to: "/contact?email=a%40b.example" },
  });

  // An authenticated admin request: this is the worst case, because the
  // framework hands Sentry the Better Auth session cookie on every one.
  Sentry.captureRequestError(
    new Error(
      `Failed to load inquiry for ${SECRETS.visitorEmail} phone ${SECRETS.visitorPhone}`,
    ),
    {
      path: "/admin/inquiries?q=visitor%40example.com&page=2",
      method: "POST",
      headers: {
        cookie: `better-auth.session_token=${SECRETS.sessionCookie}; __Secure-csrf=${SECRETS.csrfCookie}`,
        authorization: `Bearer ${SECRETS.bearer}`,
        "cf-turnstile-response": SECRETS.turnstile,
        "x-forwarded-for": SECRETS.clientIp,
        "x-nf-client-connection-ip": SECRETS.clientIp,
        "user-agent": SECRETS.userAgent,
        referer: `https://studio.example/admin/inquiries?q=${SECRETS.visitorEmail}`,
      },
    },
    { routerKind: "App Router", routePath: "/admin/inquiries", routeType: "render" },
  );

  await Sentry.flush(5000);
});

describe("the envelope the SDK actually sends", () => {
  it("sends exactly one event for one captured error", () => {
    assert.equal(captured.length, 1);
  });

  it("carries none of the request's secrets", () => {
    const wire = JSON.stringify(captured[0]);

    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!wire.includes(value), `the envelope leaked ${name}`);
    }
  });

  it("reduces the request to its method", () => {
    const event = captured[0][1][0][1];

    // Compared after serialization, because that is what reaches Sentry: keys
    // left `undefined` never make it onto the wire.
    assert.deepEqual(
      JSON.parse(JSON.stringify(event.request)),
      { method: "POST" },
      "no url, headers, cookies, body, or query string survive",
    );
    assert.equal(event.user, undefined, "nobody is identified, not even by IP");
  });

  it("strips the query string from the route path", () => {
    const contexts = captured[0][1][0][1].contexts as Record<
      string,
      Record<string, unknown>
    >;

    assert.equal(contexts.nextjs.request_path, "/admin/inquiries");
  });

  it("drops console breadcrumbs and strips navigation URLs", () => {
    const breadcrumbs = captured[0][1][0][1].breadcrumbs as {
      category: string;
      data?: Record<string, string>;
    }[];

    assert.deepEqual(
      breadcrumbs.map((crumb) => crumb.category),
      ["navigation"],
      "the console crumb carrying an address is gone",
    );
    assert.deepEqual(breadcrumbs[0].data, { from: "/work", to: "/contact" });
  });

  it("captures no local variables from the throwing frames", () => {
    const exception = captured[0][1][0][1].exception as {
      values: { stacktrace?: { frames?: Record<string, unknown>[] } }[];
    };
    const frames = exception.values[0].stacktrace?.frames ?? [];

    assert.ok(frames.length > 0, "a stack was captured at all");
    assert.equal(
      frames.filter((frame) => frame.vars).length,
      0,
      "local variables at a throw site hold the inquiry being processed",
    );
  });

  it("scrubs the exception message", () => {
    const exception = captured[0][1][0][1].exception as {
      values: { value: string }[];
    };

    assert.equal(
      exception.values[0].value,
      "Failed to load inquiry for [redacted-email] phone [redacted-number]",
    );
  });

  it("sends no transaction, session, or replay item", () => {
    const wire = JSON.stringify(captured[0]);

    for (const itemType of ["transaction", "session", "replay_event"]) {
      assert.ok(
        !wire.includes(`"type":"${itemType}"`),
        `an envelope item of type ${itemType} was sent`,
      );
    }
  });

  /**
   * Pins what the SDK *does* attach, so an upgrade that starts sending
   * something new fails here instead of in production. None of these is
   * personal data: on Netlify `server_name` is an ephemeral container id and
   * the device/OS/runtime contexts describe that container, not a visitor.
   * They are recorded in ADR 0009 rather than stripped, because they carry
   * real diagnostic value and no privacy cost.
   */
  it("pins the non-request fields the SDK attaches", () => {
    const event = captured[0][1][0][1];

    assert.deepEqual(
      Object.keys(event).sort(),
      [
        "breadcrumbs",
        "contexts",
        "environment",
        "event_id",
        "exception",
        "level",
        "modules",
        "platform",
        "request",
        "sdk",
        "server_name",
        "timestamp",
        "transaction",
      ],
      "the SDK attached a field this project has not reviewed",
    );

    const contexts = captured[0][1][0][1].contexts as Record<string, unknown>;

    assert.deepEqual(
      Object.keys(contexts).sort(),
      [
        "app",
        "cloud_resource",
        "culture",
        "device",
        "nextjs",
        "os",
        "runtime",
        "trace",
      ],
      "the SDK attached a context this project has not reviewed",
    );
  });
});
