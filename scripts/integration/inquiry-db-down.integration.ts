// Must stay first: refuses a non-approved database before anything can connect.
import "../lib/require-non-production-database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { logInquiryFailure } from "@/server/inquiry/failure-log";
import { submitInquiryWorkflow } from "@/server/inquiry/submit-inquiry";
import { consumeInquiryLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

/**
 * The inquiry workflow with the database unreachable. The orchestrator points
 * DATABASE_URL at an RFC 2606 `.invalid` host and allows no database host in the
 * network guard, so no connection can open anywhere.
 */

describe("the inquiry workflow with the database unreachable", () => {
  it("answers generically, logs a category without connection details, and saves nothing", async () => {
    assert.match(process.env.DATABASE_URL ?? "", /\.invalid\//, "this suite must run against the unreachable host");
    const lines: string[] = [];
    const original = { error: console.error, warn: console.warn };
    console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    console.warn = console.error;
    try {
      const data = new FormData();
      const fields: Record<string, string> = {
        submissionToken: randomUUID(), website: "", name: "Integration Visitor", email: "db-down@integration.invalid", phone: "", whatsapp: "",
        company: "", projectType: "Photography", projectDate: "", location: "", budgetLabel: "", serviceSlug: "", referralSource: "",
        message: "An integration message while the database is down.", "cf-turnstile-response": "itest-pass",
      };
      for (const [name, value] of Object.entries(fields)) data.set(name, value);

      const result = await submitInquiryWorkflow(data, {
        isIntakeOpen: () => true,
        findReplay: (submissionToken) => prisma.inquiry.findUnique({ where: { submissionToken }, select: { id: true, emailDeliveries: { select: { type: true } } } }),
        getTrustedClientIp: async () => "192.0.2.200",
        consumeLimit: consumeInquiryLimit,
        verifyTurnstile: (input) => verifyTurnstile(input),
        createInquiry,
        deliverEmails: async () => { throw new Error("must not be reached"); },
        logFailure: logInquiryFailure,
      });

      assert.deepEqual(result, { success: false, message: "We could not receive your inquiry. Please try again." });
      const logged = lines.join("\n");
      assert.match(logged, /"category":"replay_lookup_failed"/);
      assert.ok(!/postgres(ql)?:\/\/|integration-unavailable-password|db-down@integration\.invalid/.test(logged), "no connection string, password, or email in the log");
    } finally {
      console.error = original.error;
      console.warn = original.warn;
      await prisma.$disconnect().catch(() => undefined);
    }
  });
});
