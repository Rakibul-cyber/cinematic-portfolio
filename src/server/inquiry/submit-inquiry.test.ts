import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";

import { emptyStates } from "@/content/site";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/security/turnstile-widget";
import { InvalidServiceError } from "@/server/crm/errors";
import { logInquiryFailure, type InquiryFailureCategory } from "@/server/inquiry/failure-log";
import { submitInquiryWorkflow, type SubmitInquiryDependencies } from "@/server/inquiry/submit-inquiry";

/**
 * Runs the real inquiry workflow with every outside service replaced by a fake.
 * Nothing here can reach a database, Resend or Cloudflare: the workflow module
 * imports only types from those services. `contact/actions.ts` cannot be loaded
 * in this test mode, because the legal content imports client components, so its
 * bindings are checked from source below and by the type checker.
 */

const TOKEN = "22222222-2222-4222-8222-222222222222";
const INQUIRY_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_IP = "192.0.2.77";
const TURNSTILE_TOKEN = "turnstile-sentinel-token";
const EMAIL = "Visitor.Sentinel@Example.Test";
const MESSAGE = "A sentinel message describing the project.";
const ADMIN_DELIVERY = { type: "INQUIRY_ADMIN_NOTIFICATION", status: "ACCEPTED" } as const;
const CUSTOMER_DELIVERY = { type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT", status: "ACCEPTED" } as const;

function validForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields: Record<string, string> = {
    submissionToken: TOKEN, website: "", name: "Sentinel Visitor", email: EMAIL, phone: "", whatsapp: "", company: "",
    projectType: "Photography", projectDate: "", location: "", budgetLabel: "", serviceSlug: "", referralSource: "",
    message: MESSAGE, [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_TOKEN, ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

/** Fakes that record each call, in order, with a successful default for every step. */
function harness(overrides: Partial<SubmitInquiryDependencies> = {}) {
  const calls: string[] = [];
  const failures: Array<{ category: InquiryFailureCategory; error?: unknown }> = [];
  const captured: { limit?: unknown; turnstile?: unknown; created?: Record<string, unknown>; delivered?: string } = {};
  const record = <T>(name: string, value: T) => { calls.push(name); return value; };
  const dependencies: SubmitInquiryDependencies = {
    isIntakeOpen: () => record("gate", true),
    findReplay: async () => record("replay", null),
    getTrustedClientIp: async () => record("ip", CLIENT_IP),
    consumeLimit: async (identity) => { captured.limit = identity; return record("limit", { allowed: true, configured: true }); },
    verifyTurnstile: async (input) => { captured.turnstile = input; return record("turnstile", { ok: true, bypassed: false }); },
    createInquiry: async (data) => { captured.created = data; return record("create", { id: INQUIRY_ID, duplicate: false }); },
    deliverEmails: async (id) => { captured.delivered = id; return record("deliver", [ADMIN_DELIVERY, CUSTOMER_DELIVERY]); },
    logFailure: (category, error) => { failures.push({ category, error }); },
    ...overrides,
  };
  return { calls, captured, dependencies, failures, categories: () => failures.map((failure) => failure.category) };
}

describe("closed privacy gate", () => {
  it("answers with the closed wording and does no other work", async () => {
    const h = harness({ isIntakeOpen: () => false });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(result, { success: false, message: emptyStates.inquiry });
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.categories(), ["intake_closed"]);
  });

});

describe("schema validation", () => {
  it("returns field errors and stops before the database", async () => {
    const h = harness();
    const result = await submitInquiryWorkflow(validForm({ email: "not-an-email", message: "short" }), h.dependencies);
    assert.equal(result.success, false);
    assert.equal(result.message, "Please check the highlighted fields.");
    assert.ok(result.errors?.email?.length);
    assert.ok(result.errors?.message?.length);
    assert.deepEqual(h.calls, ["gate"]);
    assert.deepEqual(h.categories(), ["validation_rejected"]);
  });

  it("rejects a malformed submission token", async () => {
    const h = harness();
    const result = await submitInquiryWorkflow(validForm({ submissionToken: "not-a-uuid" }), h.dependencies);
    assert.equal(result.success, false);
    assert.deepEqual(h.calls, ["gate"]);
  });
});

describe("honeypot", () => {
  it("rejects a filled honeypot before any service, and reports it separately", async () => {
    const h = harness();
    const result = await submitInquiryWorkflow(validForm({ website: "https://spam.example" }), h.dependencies);
    assert.equal(result.success, false);
    assert.deepEqual(h.calls, ["gate"]);
    assert.deepEqual(h.categories(), ["honeypot_rejected"]);
  });
});

describe("replay handling", () => {
  it("answers a completed replay with the ordinary success and spends nothing", async () => {
    const h = harness({ findReplay: async () => ({ id: INQUIRY_ID, emailDeliveries: [{ type: "INQUIRY_ADMIN_NOTIFICATION" }, { type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT" }] }) });
    const replayed = await submitInquiryWorkflow(validForm(), h.dependencies);
    const first = await submitInquiryWorkflow(validForm(), harness().dependencies);
    assert.deepEqual(replayed, first, "indistinguishable from a first submission");
    assert.deepEqual(h.calls, ["gate"]);
    assert.deepEqual(h.failures, []);
  });

  it("recovers only a genuinely unclaimed delivery, still without a new inquiry or abuse-control attempt", async () => {
    const h = harness({ findReplay: async () => ({ id: INQUIRY_ID, emailDeliveries: [{ type: "INQUIRY_ADMIN_NOTIFICATION" }] }) });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.equal(result.success, true);
    assert.deepEqual(h.calls, ["gate", "deliver"]);
    assert.equal(h.captured.delivered, INQUIRY_ID);
  });

  it("reports a failed replay lookup under its own category", async () => {
    const h = harness({ findReplay: async () => { throw new Error("down"); } });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.equal(result.success, false);
    assert.deepEqual(h.categories(), ["replay_lookup_failed"]);
  });
});

describe("rate limiting", () => {
  it("refuses a limited submission before Turnstile and the database", async () => {
    const h = harness({ consumeLimit: async () => ({ allowed: false, configured: true }) });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(result, { success: false, message: "We could not receive your inquiry. Please try again later." });
    assert.deepEqual(h.calls, ["gate", "replay", "ip"]);
    assert.deepEqual(h.categories(), ["rate_limited"]);
  });

  it("gives the visitor the same answer when the limiter is unconfigured, but logs the fault", async () => {
    const h = harness({ consumeLimit: async () => ({ allowed: false, configured: false }) });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.equal(result.message, "We could not receive your inquiry. Please try again later.");
    assert.deepEqual(h.categories(), ["rate_limit_unconfigured"]);
  });

  it("keys the limit on the normalized email and the trusted client IP", async () => {
    const h = harness();
    await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(h.captured.limit, { submissionToken: TOKEN, normalizedEmail: EMAIL.toLowerCase(), trustedClientIp: CLIENT_IP });
  });

  it("omits the IP entirely when the platform header is absent", async () => {
    const h = harness({ getTrustedClientIp: async () => undefined });
    await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(h.captured.limit, { submissionToken: TOKEN, normalizedEmail: EMAIL.toLowerCase() });
    assert.deepEqual(h.captured.turnstile, { token: TURNSTILE_TOKEN });
  });

  it("fails safely when the limiter throws", async () => {
    const h = harness({ consumeLimit: async () => { throw new Error("down"); } });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(result, { success: false, message: "We could not receive your inquiry. Please try again." });
    assert.deepEqual(h.categories(), ["rate_limit_failed"]);
  });
});

describe("Turnstile", () => {
  for (const [reason, category] of [["invalid", "turnstile_invalid"], ["misconfigured", "turnstile_misconfigured"], ["unavailable", "turnstile_unavailable"]] as const) {
    it(`refuses on ${reason}, stores nothing, and logs ${category}`, async () => {
      const h = harness({ verifyTurnstile: async () => ({ ok: false, reason }) });
      const result = await submitInquiryWorkflow(validForm(), h.dependencies);
      assert.deepEqual(result, { success: false, message: "Verification failed. Please try again." });
      assert.deepEqual(h.calls, ["gate", "replay", "ip", "limit"]);
      assert.deepEqual(h.categories(), [category]);
    });
  }

  it("sends the submitted token and the trusted IP for verification", async () => {
    const h = harness();
    await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(h.captured.turnstile, { token: TURNSTILE_TOKEN, remoteIp: CLIENT_IP });
  });

  it("fails safely when verification throws", async () => {
    const h = harness({ verifyTurnstile: async () => { throw new Error("down"); } });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.equal(result.success, false);
    assert.deepEqual(h.categories(), ["turnstile_failed"]);
  });
});

describe("database failure", () => {
  it("answers generically, sends no email, and never passes the error to the visitor", async () => {
    const h = harness({ createInquiry: async () => { throw Object.assign(new Error(`constraint on ${EMAIL}`), { name: "PrismaClientKnownRequestError", code: "P1001" }); } });
    const result = await submitInquiryWorkflow(validForm(), h.dependencies);
    assert.deepEqual(result, { success: false, message: "We could not receive your inquiry. Please try again." });
    assert.deepEqual(h.calls, ["gate", "replay", "ip", "limit", "turnstile"]);
    assert.deepEqual(h.categories(), ["persistence_failed"]);
  });

  it("names an unavailable service on its field, with its fixed message", async () => {
    const h = harness({ createInquiry: async () => { throw new InvalidServiceError("The selected service is no longer available."); } });
    const result = await submitInquiryWorkflow(validForm({ serviceSlug: "retired" }), h.dependencies);
    assert.deepEqual(result, { success: false, message: "The selected service is no longer available.", errors: { serviceSlug: ["The selected service is no longer available."] } });
    assert.deepEqual(h.categories(), ["invalid_service"]);
  });
});

describe("successful persistence", () => {
  it("runs every step in order, stores the parsed submission, then delivers for that inquiry", async () => {
    const h = harness();
    const result = await submitInquiryWorkflow(validForm({ budgetLabel: "  5000 EUR  ", projectDate: "2027-03-14" }), h.dependencies);
    assert.deepEqual(result, { success: true, message: "Thank you. Your inquiry has been received." });
    assert.deepEqual(h.calls, ["gate", "replay", "ip", "limit", "turnstile", "create", "deliver"]);
    assert.equal(h.captured.created?.message, MESSAGE);
    assert.equal(h.captured.created?.budgetLabel, "5000 EUR");
    assert.equal(h.captured.created?.phone, null);
    assert.deepEqual(h.captured.created?.projectDate, new Date("2027-03-14T00:00:00.000Z"));
    assert.ok(!(TURNSTILE_RESPONSE_FIELD in h.captured.created!), "the challenge token is not stored");
    assert.equal(h.captured.delivered, INQUIRY_ID);
    assert.deepEqual(h.failures, []);
  });
});

describe("email failure after persistence", () => {
  const success = { success: true, message: "Thank you. Your inquiry has been received." };

  it("keeps the visitor's success when delivery fails, and logs it", async () => {
    const h = harness({ deliverEmails: async () => [{ type: "INQUIRY_ADMIN_NOTIFICATION", status: "FAILED" }, { type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT", status: "ACCEPTED" }] });
    assert.deepEqual(await submitInquiryWorkflow(validForm(), h.dependencies), success);
    assert.deepEqual(h.categories(), ["email_failed"]);
  });

  it("makes unconfigured email visible, instead of a silent skip", async () => {
    const h = harness({ deliverEmails: async () => [{ type: "INQUIRY_ADMIN_NOTIFICATION", status: "SKIPPED" }, { type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT", status: "SKIPPED" }] });
    assert.deepEqual(await submitInquiryWorkflow(validForm(), h.dependencies), success);
    assert.deepEqual(h.categories(), ["email_skipped"]);
  });

  it("logs orchestration that attempted nothing", async () => {
    const h = harness({ deliverEmails: async () => [] });
    assert.deepEqual(await submitInquiryWorkflow(validForm(), h.dependencies), success);
    assert.deepEqual(h.categories(), ["email_orchestration_failed"]);
  });

  it("keeps the success even if delivery unexpectedly throws: the inquiry is already stored", async () => {
    const h = harness({ deliverEmails: async () => { throw new Error("down"); } });
    assert.deepEqual(await submitInquiryWorkflow(validForm(), h.dependencies), success);
    assert.deepEqual(h.categories(), ["email_orchestration_failed"]);
  });

  it("does not report a delivery another request already owns", async () => {
    const h = harness({ deliverEmails: async () => [{ type: "INQUIRY_ADMIN_NOTIFICATION", status: "FAILED", alreadyClaimed: true }] });
    assert.deepEqual(await submitInquiryWorkflow(validForm(), h.dependencies), success);
    assert.deepEqual(h.failures, []);
  });
});

describe("privacy-safe failure logging", () => {
  function captureConsole() {
    const lines: string[] = [];
    const push = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    const error = mock.method(console, "error", push);
    const warn = mock.method(console, "warn", push);
    return { lines, error, warn, restore: () => { error.mock.restore(); warn.mock.restore(); } };
  }

  it("writes one JSON line with the category and the error's class and Prisma code only", () => {
    const output = captureConsole();
    try {
      logInquiryFailure("persistence_failed", Object.assign(new Error("Unique constraint on someone@example.test"), { name: "PrismaClientKnownRequestError", code: "P2002" }));
      assert.deepEqual(output.lines.map((line) => JSON.parse(line)), [{ scope: "inquiry", category: "persistence_failed", errorName: "PrismaClientKnownRequestError", errorCode: "P2002" }]);
    } finally { output.restore(); }
  });

  it("drops an error name or code that is not a plain identifier", () => {
    const output = captureConsole();
    try {
      logInquiryFailure("persistence_failed", { name: "someone@example.test", code: "192.0.2.1" });
      logInquiryFailure("persistence_failed", "a thrown string with someone@example.test");
      assert.deepEqual(output.lines.map((line) => JSON.parse(line)), [{ scope: "inquiry", category: "persistence_failed" }, { scope: "inquiry", category: "persistence_failed" }]);
    } finally { output.restore(); }
  });

  it("logs expected refusals as warnings and faults as errors", () => {
    const output = captureConsole();
    try {
      logInquiryFailure("rate_limited");
      logInquiryFailure("rate_limit_unconfigured");
      assert.equal(output.warn.mock.callCount(), 1);
      assert.equal(output.error.mock.callCount(), 1);
    } finally { output.restore(); }
  });

  it("leaks no visitor data, IP or token through any failing path of the workflow", async () => {
    const sentinels = [EMAIL, EMAIL.toLowerCase(), MESSAGE, "Sentinel Visitor", CLIENT_IP, TURNSTILE_TOKEN, TOKEN];
    const hostile = () => Object.assign(new Error(sentinels.join(" ")), { code: sentinels.join(" ") });
    const paths: Partial<SubmitInquiryDependencies>[] = [
      { isIntakeOpen: () => false },
      { findReplay: async () => { throw hostile(); } },
      { consumeLimit: async () => { throw hostile(); } },
      { consumeLimit: async () => ({ allowed: false, configured: true }) },
      { verifyTurnstile: async () => { throw hostile(); } },
      { verifyTurnstile: async () => ({ ok: false, reason: "invalid" }) },
      { createInquiry: async () => { throw hostile(); } },
      { deliverEmails: async () => { throw hostile(); } },
    ];
    const output = captureConsole();
    try {
      for (const overrides of paths) {
        await submitInquiryWorkflow(validForm(), harness({ ...overrides, logFailure: logInquiryFailure }).dependencies);
      }
      await submitInquiryWorkflow(validForm({ email: "bad" }), harness({ logFailure: logInquiryFailure }).dependencies);
    } finally { output.restore(); }
    assert.equal(output.lines.length, paths.length + 1, "every failing path logged exactly once");
    const logged = output.lines.join("\n");
    for (const sentinel of sentinels) assert.ok(!logged.includes(sentinel), `the log carries no ${sentinel}`);
  });

  it("never returns error text to the visitor", async () => {
    const result = await submitInquiryWorkflow(validForm(), harness({ createInquiry: async () => { throw new Error("connection string secret"); } }).dependencies);
    assert.ok(!JSON.stringify(result).includes("secret"));
  });
});

describe("the action's wiring", () => {
  let source: string;
  before(() => { source = readFileSync("src/app/(public)/contact/actions.ts", "utf8"); });

  it("binds the platform client-IP header and never trusts X-Forwarded-For", () => {
    assert.match(source, /get\("x-nf-client-connection-ip"\)/);
    assert.doesNotMatch(source, /x-forwarded-for/i);
  });

  it("binds each real service", () => {
    for (const binding of ["consumeLimit: consumeInquiryLimit", "verifyTurnstile: (input) => verifyTurnstile(input)", "deliverEmails: (inquiryId) => deliverInquiryEmails(inquiryId)", "logFailure: logInquiryFailure", "submitInquiryWorkflow(form, dependencies)"]) {
      assert.ok(source.includes(binding), binding);
    }
    assert.match(source, /^\s*createInquiry,$/m);
  });

  it("selects no inquiry personal data in the replay lookup", () => {
    assert.match(source, /select: \{ id: true, emailDeliveries: \{ select: \{ type: true \} \} \}/);
  });
});
