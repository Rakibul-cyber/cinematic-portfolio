import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSafeInternalPath } from "@/lib/admin-routes";
import { securityHeaders } from "@/lib/security-headers";
import { pseudonymousKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import {
  TURNSTILE_ACTION,
  TURNSTILE_RESPONSE_FIELD,
  TURNSTILE_SCRIPT_URL,
  turnstileRenderOptions,
} from "@/lib/security/turnstile-widget";
import { hasAllDeliveryClaims } from "@/lib/email/delivery-claims";
import { EMAIL_DELIVERY_TYPES } from "@/lib/validation/crm";

describe("security headers", () => {
  it("uses a narrow application-specific CSP", () => {
    const headers = securityHeaders({ NODE_ENV: "production", R2_PUBLIC_BASE_URL: "https://media.example.test/path" });
    const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /challenges\.cloudflare\.com/);
    assert.match(csp, /youtube-nocookie\.com/);
    assert.match(csp, /player\.vimeo\.com/);
    assert.match(csp, /https:\/\/media\.example\.test/);
    assert.ok(!csp.includes("default-src *"));
    assert.ok(!csp.includes("frame-src *"));
    assert.ok(headers.some((header) => header.key === "Strict-Transport-Security"));
  });

  it("does not apply HSTS or insecure-request upgrades in development", () => {
    const headers = securityHeaders({ NODE_ENV: "development" });
    assert.ok(!headers.some((header) => header.key === "Strict-Transport-Security"));
    assert.ok(!headers.find((header) => header.key === "Content-Security-Policy")?.value.includes("upgrade-insecure-requests"));
  });
});

describe("abuse-control privacy", () => {
  it("creates stable pseudonymous keys without retaining the source", () => {
    const raw = "203.0.113.42";
    const first = pseudonymousKey(raw, "x".repeat(32));
    assert.equal(first, pseudonymousKey(raw, "x".repeat(32)));
    assert.equal(first.length, 64);
    assert.ok(!first.includes(raw));
  });
});

describe("Turnstile verification", () => {
  const env = { NODE_ENV: "production", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret", TURNSTILE_EXPECTED_HOSTNAME: "studio.example" };
  const response = (body: unknown, ok = true) => async () => ({ ok, json: async () => body }) as Response;
  it("accepts a valid expected response", async () => {
    assert.deepEqual(await verifyTurnstile({ token: "token" }, { env, fetcher: response({ success: true, hostname: "studio.example", action: "inquiry", challenge_ts: new Date().toISOString() }) }), { ok: true, bypassed: false });
  });
  it("rejects invalid responses and provider failures", async () => {
    assert.equal((await verifyTurnstile({ token: "token" }, { env, fetcher: response({ success: false }) })).ok, false);
    assert.deepEqual(await verifyTurnstile({ token: "token" }, { env, fetcher: response({}, false) }), { ok: false, reason: "unavailable" });
  });
  it("fails closed for missing production configuration", async () => {
    assert.deepEqual(await verifyTurnstile({ token: "" }, { env: { NODE_ENV: "production" } }), { ok: false, reason: "misconfigured" });
  });
});

describe("login redirect safety", () => {
  it("rejects external, protocol-relative, encoded and script targets", () => {
    const hostile = [
      "https://evil.example", "//evil.example", "///evil.example", "/\\evil.example",
      "/%2F%2Fevil.example", "%2F%2Fevil.example", "%252F%252Fevil.example",
      "javascript:alert(1)", "data:text/html,<script>1</script>", "http:/evil.example",
      "//evil.example", "/⁄evil.example",
    ];
    for (const value of hostile) {
      assert.equal(isSafeInternalPath(value), false, `accepted ${value}`);
    }
  });

  it("accepts only admin-area paths", () => {
    assert.equal(isSafeInternalPath("/admin"), true);
    assert.equal(isSafeInternalPath("/admin/customers/1"), true);
    // An encoded traversal stays a same-origin admin path once the browser
    // resolves it, so it is safe to keep, but a sibling prefix is not.
    assert.equal(isSafeInternalPath("/administrator-evil"), false);
    assert.equal(isSafeInternalPath(undefined), false);
  });
});

describe("Turnstile configuration modes", () => {
  const ok = async () => ({ ok: true, json: async () => ({ success: true }) }) as Response;
  const cases: Array<[string, Record<string, string | undefined>, boolean]> = [
    ["site key only", { TURNSTILE_SITE_KEY: "site" }, false],
    ["secret only", { TURNSTILE_SECRET_KEY: "secret" }, false],
    ["hostname without keys", { TURNSTILE_EXPECTED_HOSTNAME: "studio.example" }, false],
    ["whitespace-only keys", { TURNSTILE_SITE_KEY: "  ", TURNSTILE_SECRET_KEY: "	" }, false],
  ];
  for (const [label, partial, expected] of cases) {
    it(`fails closed in production with ${label}`, async () => {
      const result = await verifyTurnstile({ token: "token" }, { env: { NODE_ENV: "production", ...partial }, fetcher: ok });
      assert.equal(result.ok, expected, `${label} must not pass`);
    });
  }

  it("bypasses in development only when both keys are absent", async () => {
    assert.deepEqual(await verifyTurnstile({ token: "" }, { env: { NODE_ENV: "development" }, fetcher: ok }), { ok: true, bypassed: true });
    // A half-configured development environment must not silently bypass.
    assert.equal((await verifyTurnstile({ token: "" }, { env: { NODE_ENV: "development", TURNSTILE_SITE_KEY: "site" }, fetcher: ok })).ok, false);
  });
});

describe("Turnstile malformed input and provider faults", () => {
  const env = { NODE_ENV: "production", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
  let calls = 0;
  const counting = async () => { calls += 1; return { ok: true, json: async () => ({ success: true }) } as Response; };

  it("rejects unusable tokens without calling the provider", async () => {
    calls = 0;
    for (const token of ["", "   ".repeat(0), "x".repeat(2049)]) {
      assert.equal((await verifyTurnstile({ token }, { env, fetcher: counting })).ok, false, `accepted ${token.length} chars`);
    }
    assert.equal(calls, 0, "no outbound request for a token that cannot be valid");
  });

  it("treats control characters and unexpected Unicode as provider-decided, never as a crash", async () => {
    for (const token of ["a\u0000b", "\u202Eevil", "   "]) {
      const result = await verifyTurnstile({ token }, { env, fetcher: async () => ({ ok: true, json: async () => ({ success: false }) }) as Response });
      assert.deepEqual(result, { ok: false, reason: "invalid" });
    }
  });

  it("fails closed on malformed JSON, network failure and timeout", async () => {
    const malformed = async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }) as unknown as Response;
    assert.deepEqual(await verifyTurnstile({ token: "t" }, { env, fetcher: malformed }), { ok: false, reason: "unavailable" });
    const network = async () => { throw new TypeError("fetch failed"); };
    assert.deepEqual(await verifyTurnstile({ token: "t" }, { env, fetcher: network as unknown as typeof fetch }), { ok: false, reason: "unavailable" });
    const timeout = async () => { throw new DOMException("The operation was aborted.", "TimeoutError"); };
    assert.deepEqual(await verifyTurnstile({ token: "t" }, { env, fetcher: timeout as unknown as typeof fetch }), { ok: false, reason: "unavailable" });
  });

  it("never echoes the token or provider payload to the caller", async () => {
    const result = await verifyTurnstile({ token: "super-secret-token" }, { env, fetcher: async () => ({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) }) as Response });
    assert.equal(JSON.stringify(result).includes("super-secret-token"), false);
    assert.equal(JSON.stringify(result).includes("invalid-input-response"), false);
  });

  it("rejects a response from an unexpected hostname or action", async () => {
    const scoped = { ...env, TURNSTILE_EXPECTED_HOSTNAME: "studio.example" };
    const body = (extra: Record<string, unknown>) => async () => ({ ok: true, json: async () => ({ success: true, hostname: "studio.example", action: "inquiry", ...extra }) }) as Response;
    assert.equal((await verifyTurnstile({ token: "t" }, { env: scoped, fetcher: body({ hostname: "evil.example" }) })).ok, false);
    assert.equal((await verifyTurnstile({ token: "t" }, { env: scoped, fetcher: body({ action: "signup" }) })).ok, false);
    // A challenge solved long ago must not be replayed.
    assert.equal((await verifyTurnstile({ token: "t" }, { env: scoped, fetcher: body({ challenge_ts: new Date(Date.now() - 60 * 60_000).toISOString() }) })).ok, false);
  });
});

describe("committed-submission replay cost", () => {
  const [ADMIN, CUSTOMER] = EMAIL_DELIVERY_TYPES;

  it("A. treats a fully claimed submission as complete, so replay skips orchestration", () => {
    assert.equal(hasAllDeliveryClaims([{ type: ADMIN }, { type: CUSTOMER }]), true);
    // Order is irrelevant; only the set of claimed types matters.
    assert.equal(hasAllDeliveryClaims([{ type: CUSTOMER }, { type: ADMIN }]), true);
  });

  it("B. reports a genuinely unclaimed delivery so recovery still runs", () => {
    assert.equal(hasAllDeliveryClaims([{ type: ADMIN }]), false);
    assert.equal(hasAllDeliveryClaims([{ type: CUSTOMER }]), false);
    // An interrupted first submission that claimed nothing must still recover.
    assert.equal(hasAllDeliveryClaims([]), false);
  });

  it("C. never treats a FAILED or SKIPPED row as missing", () => {
    // The replay lookup selects `type` alone, so a definite failure outcome is
    // structurally indistinguishable from a success here: both are claims. A
    // failed delivery is recovered by the admin retry workflow, never by a
    // public replay, so this must report nothing to do.
    const failedAndSkipped = [{ type: ADMIN }, { type: CUSTOMER }];
    assert.equal(hasAllDeliveryClaims(failedAndSkipped), true);
  });

  it("ignores duplicate or unexpected rows rather than miscounting", () => {
    assert.equal(hasAllDeliveryClaims([{ type: ADMIN }, { type: ADMIN }]), false);
  });
});

describe("Turnstile browser contract", () => {
  // Phase 10A: the deployed widget was invisible and no response field was
  // ever submitted, because implicit rendering raced React hydration. These
  // assert the contract that removes the race, and that the field and action
  // the browser produces are the ones the server verifies.
  it("loads the provider script in explicit-render mode", () => {
    assert.match(TURNSTILE_SCRIPT_URL, /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?/);
    assert.match(TURNSTILE_SCRIPT_URL, /[?&]render=explicit(&|$)/, "implicit mode scans the DOM and loses the race with hydration");
  });

  it("renders with the action the server asserts, and no provider-owned response field", () => {
    const options = turnstileRenderOptions("1x00000000000000000000AA", {
      onToken: () => {},
      onExpired: () => {},
      onError: () => {},
    });
    assert.equal(options.action, "inquiry");
    assert.equal(TURNSTILE_ACTION, "inquiry");
    assert.equal(options["response-field"], false);
    assert.equal(options.sitekey, "1x00000000000000000000AA");
    assert.equal(options.theme, "dark");
  });

  it("names the response field the server action reads", () => {
    assert.equal(TURNSTILE_RESPONSE_FIELD, "cf-turnstile-response");
  });

  it("keeps the server authoritative over the action the browser claims", async () => {
    const env = { NODE_ENV: "production", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
    const body = (action: string) => async () => ({ ok: true, json: async () => ({ success: true, action }) }) as Response;
    assert.equal((await verifyTurnstile({ token: "t" }, { env, fetcher: body(TURNSTILE_ACTION) })).ok, true);
    assert.equal((await verifyTurnstile({ token: "t" }, { env, fetcher: body("something-else") })).ok, false);
  });
});
