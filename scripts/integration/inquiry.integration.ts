// Must stay first: refuses a non-approved database before anything can connect.
import "../lib/require-non-production-database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import { normalizeEmail } from "@/lib/validation/crm";
import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { deliverInquiryEmails } from "@/server/email/service";
import type { InquiryFailureCategory } from "@/server/inquiry/failure-log";
import { submitInquiryWorkflow, type SubmitInquiryDependencies } from "@/server/inquiry/submit-inquiry";
import { consumeInquiryLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

/**
 * The inquiry workflow bound to the real services on the disposable branch,
 * exactly as `contact/actions.ts` binds them, except for `isIntakeOpen`.
 *
 * The open-gate override exists only inside this test process. Legal content and
 * approvals are untouched, and the public action keeps the real closed gate; the
 * HTTP suite proves that against the built server. Turnstile goes through the
 * real global fetch, which the network guard answers locally, and with no Resend
 * key configured email is recorded as skipped and never sent.
 */

const created = new Set<string>();
const emails = new Set<string>();
let ipCounter = 0;
const ip = () => `192.0.2.${++ipCounter}`;

const TURNSTILE_ENV = { TURNSTILE_SITE_KEY: "integration-dummy-site-key", TURNSTILE_SECRET_KEY: "integration-dummy-secret-key" };

function harness(options: { open: boolean; turnstileEnv?: Record<string, string | undefined> }) {
  const failures: InquiryFailureCategory[] = [];
  const steps: string[] = [];
  const dependencies: SubmitInquiryDependencies = {
    isIntakeOpen: () => options.open,
    findReplay: (submissionToken) => {
      steps.push("replay");
      return prisma.inquiry.findUnique({ where: { submissionToken }, select: { id: true, emailDeliveries: { select: { type: true } } } });
    },
    getTrustedClientIp: async () => ip(),
    consumeLimit: (identity) => { steps.push("limit"); return consumeInquiryLimit(identity); },
    verifyTurnstile: (input) => { steps.push("turnstile"); return verifyTurnstile(input, { env: options.turnstileEnv ?? TURNSTILE_ENV }); },
    createInquiry: async (data) => { steps.push("create"); const result = await createInquiry(data); created.add(result.id); return result; },
    deliverEmails: (inquiryId) => { steps.push("deliver"); return deliverInquiryEmails(inquiryId); },
    logFailure: (category) => { failures.push(category); },
  };
  return { dependencies, failures, steps };
}

function form(turnstileToken: string) {
  const email = `inquiry-${randomUUID().slice(0, 8)}@integration.invalid`;
  emails.add(normalizeEmail(email));
  const data = new FormData();
  const fields: Record<string, string> = {
    submissionToken: randomUUID(), website: "", name: "Integration Visitor", email, phone: "", whatsapp: "", company: "",
    projectType: "Photography", projectDate: "", location: "", budgetLabel: "", serviceSlug: "", referralSource: "",
    message: "An integration message for the disposable branch.", "cf-turnstile-response": turnstileToken,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return { data, email: normalizeEmail(email) };
}

const savedFor = (email: string) => prisma.inquiry.count({ where: { emailSnapshot: { equals: email, mode: "insensitive" } } });

after(async () => {
  // Best-effort tidy-up; the whole branch is deleted after the run.
  const inquiries = await prisma.inquiry.findMany({ where: { id: { in: [...created] } }, select: { customerId: true } });
  await prisma.inquiry.deleteMany({ where: { id: { in: [...created] } } });
  await prisma.customer.deleteMany({ where: { id: { in: inquiries.map((row) => row.customerId) } } });
  await prisma.$disconnect();
});

describe("preconditions", () => {
  it("runs with no runtime NODE_ENV and no real service keys", () => {
    assert.equal(process.env.NODE_ENV, undefined, "a development or test mode would permit the Turnstile bypass");
    for (const name of ["RESEND_API_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "SENTRY_AUTH_TOKEN", "NEXT_PUBLIC_SENTRY_DSN"]) {
      assert.equal(process.env[name], undefined, name);
    }
  });
});

describe("the closed gate with real services", () => {
  it("does no work and saves nothing", async () => {
    const h = harness({ open: false });
    const submission = form("itest-pass");
    const result = await submitInquiryWorkflow(submission.data, h.dependencies);
    assert.deepEqual(result, { success: false, message: "Online inquiries will open soon." });
    assert.deepEqual(h.steps, []);
    assert.deepEqual(h.failures, ["intake_closed"]);
    assert.equal(await savedFor(submission.email), 0);
  });
});

describe("Turnstile with the gate opened in this process only", () => {
  const refusals: Array<[string, string, Record<string, string | undefined>, InquiryFailureCategory]> = [
    ["no Turnstile configuration", "itest-pass", {}, "turnstile_misconfigured"],
    ["only a site key", "itest-pass", { TURNSTILE_SITE_KEY: "integration-dummy-site-key" }, "turnstile_misconfigured"],
    ["a token the provider rejects", "itest-fail", TURNSTILE_ENV, "turnstile_invalid"],
    ["an empty token", "", TURNSTILE_ENV, "turnstile_invalid"],
    ["the provider unavailable", "itest-unavailable", TURNSTILE_ENV, "turnstile_unavailable"],
  ];
  for (const [label, token, turnstileEnv, category] of refusals) {
    it(`refuses and saves nothing with ${label}`, async () => {
      const h = harness({ open: true, turnstileEnv });
      const submission = form(token);
      const result = await submitInquiryWorkflow(submission.data, h.dependencies);
      assert.deepEqual(result, { success: false, message: "Verification failed. Please try again." });
      assert.deepEqual(h.failures, [category]);
      assert.ok(!h.steps.includes("create"));
      assert.equal(await savedFor(submission.email), 0);
    });
  }

  it("saves exactly one inquiry for a valid challenge, and sends no email", async () => {
    const h = harness({ open: true });
    const submission = form("itest-pass");
    const result = await submitInquiryWorkflow(submission.data, h.dependencies);
    assert.deepEqual(result, { success: true, message: "Thank you. Your inquiry has been received." });
    assert.equal(await savedFor(submission.email), 1);
    const deliveries = await prisma.emailDelivery.findMany({ where: { inquiry: { emailSnapshot: { equals: submission.email, mode: "insensitive" } } } });
    assert.equal(deliveries.length, 2);
    assert.ok(deliveries.every((delivery) => delivery.status === "SKIPPED"), "no Resend key: recorded as skipped, never sent");
  });
});

describe("inquiry rate limits on PostgreSQL", () => {
  it("lets exactly five of six simultaneous submissions from one identity through", async () => {
    const identity = { submissionToken: randomUUID(), normalizedEmail: `burst-${randomUUID().slice(0, 8)}@integration.invalid`, trustedClientIp: ip() };
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeInquiryLimit(identity)));
    assert.equal(results.filter((result) => result.allowed).length, 5);
    assert.ok(results.every((result) => result.configured));
    const rows = await prisma.rateLimitBucket.findMany({ where: { scope: "inquiry:burst" } });
    assert.ok(rows.some((row) => row.count === 6));
  });

  it("refuses, writing nothing, when RATE_LIMIT_HMAC_SECRET is missing", async () => {
    const saved = process.env.RATE_LIMIT_HMAC_SECRET;
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    const original = console.error;
    console.error = () => undefined;
    try {
      const before = await prisma.rateLimitBucket.count();
      const h = harness({ open: true });
      const submission = form("itest-pass");
      const result = await submitInquiryWorkflow(submission.data, h.dependencies);
      assert.deepEqual(result, { success: false, message: "We could not receive your inquiry. Please try again later." });
      assert.deepEqual(h.failures, ["rate_limit_unconfigured"]);
      assert.ok(!h.steps.includes("turnstile") && !h.steps.includes("create"));
      assert.equal(await prisma.rateLimitBucket.count(), before);
      assert.equal(await savedFor(submission.email), 0);
    } finally {
      console.error = original;
      if (saved !== undefined) process.env.RATE_LIMIT_HMAC_SECRET = saved;
    }
  });
});
