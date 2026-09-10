import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatMailAddress,
  isEmailAddress,
  MAX_SUBJECT_LENGTH,
  parseMailAddress,
  parseMailAddressList,
  sanitizeSubject,
} from "@/lib/email/address";
import {
  buildAdminNotification,
  buildCustomerAcknowledgment,
  formatProjectDate,
  formatSubmittedAt,
  toPlainText,
  type InquirySnapshot,
} from "@/emails/inquiry-content";
import { parseEmailConfig } from "@/server/email/config";
import { toErrorCode } from "@/server/email/client";

const inquiry: InquirySnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: new Date("2026-09-11T09:05:00.000Z"),
  nameSnapshot: "Jane Smith",
  emailSnapshot: "jane@example.invalid",
  phoneSnapshot: "+49 30 123456",
  whatsappSnapshot: null,
  companySnapshot: "Studio A",
  serviceNameSnapshot: "Wedding Photography",
  // Stored as a PostgreSQL DATE, which Prisma returns as midnight UTC.
  projectDate: new Date("2027-02-03T00:00:00.000Z"),
  projectType: "Wedding",
  location: "Berlin",
  budgetLabel: "EUR 3000+",
  referralSource: "Instagram",
  message: "We would love to work with you.",
};

describe("email addresses", () => {
  it("accepts plain and display-name forms", () => {
    assert.deepEqual(parseMailAddress("studio@example.com"), {
      address: "studio@example.com",
    });
    assert.deepEqual(parseMailAddress("Studio Name <studio@example.com>"), {
      address: "studio@example.com",
      name: "Studio Name",
    });
    assert.equal(
      formatMailAddress({ address: "a@b.co", name: "A B" }),
      "A B <a@b.co>",
    );
  });

  it("rejects malformed addresses and header injection attempts", () => {
    for (const value of [
      "not-an-address",
      "missing@tld",
      "spaced address@example.com",
      "studio@example.com\nBcc: evil@example.com",
      "Name <studio@example.com>\r\nBcc: evil@example.com",
      "",
    ]) {
      assert.equal(parseMailAddress(value), null, `accepted: ${value}`);
    }
    assert.equal(isEmailAddress("studio@example.com\r\n"), false);
  });

  it("parses recipient lists, rejecting any invalid entry", () => {
    assert.deepEqual(parseMailAddressList("a@example.com, b@example.com"), [
      { address: "a@example.com" },
      { address: "b@example.com" },
    ]);
    // One typo is a configuration error worth surfacing, not something to drop.
    assert.equal(parseMailAddressList("a@example.com, broken"), null);
    assert.equal(parseMailAddressList("   "), null);
    // Duplicates collapse so nobody is mailed twice.
    assert.equal(
      parseMailAddressList("a@example.com, A@Example.com")?.length,
      1,
    );
  });

  it("sanitizes display names so a submitted name cannot break the envelope", () => {
    // The visitor's own name becomes the Reply-To display name, so it is the
    // one header component that carries untrusted input.
    const hostile = String.fromCharCode(13, 10);
    assert.equal(
      formatMailAddress({
        address: "jane@example.invalid",
        name: `Jane${hostile}Bcc: evil@example.com`,
      }),
      "Jane Bcc evilexample.com <jane@example.invalid>",
    );
    // A name that tries to smuggle a second address keeps its text but loses
    // every character that could make it a separate envelope entry.
    const smuggled = formatMailAddress({
      address: "jane@example.invalid",
      name: 'Evil" <evil@example.com>, "',
    });
    assert.ok(smuggled.endsWith("<jane@example.invalid>"));
    assert.equal(smuggled.match(/</g)?.length, 1);
    assert.ok(!smuggled.includes('"'));
    assert.ok(!/[,():;@\\]/.test(smuggled.slice(0, smuggled.indexOf("<"))));
    assert.equal(
      formatMailAddress({
        address: "jane@example.invalid",
        name: "Miyuki 山田, Cc: victim@example.com; (team)",
      }),
      "Miyuki 山田 Cc victimexample.com team <jane@example.invalid>",
    );
    // A name that sanitizes down to nothing leaves a bare address.
    assert.equal(
      formatMailAddress({ address: "jane@example.invalid", name: "<>" }),
      "jane@example.invalid",
    );
  });

  it("strips line breaks and bounds subjects", () => {
    assert.equal(
      sanitizeSubject("New inquiry\r\nBcc: evil@example.com"),
      "New inquiry Bcc: evil@example.com",
    );
    assert.ok(sanitizeSubject("x".repeat(400)).length <= MAX_SUBJECT_LENGTH);
  });
});

describe("email configuration", () => {
  const valid = {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Studio <studio@example.com>",
    EMAIL_ADMIN_RECIPIENTS: "studio@example.com",
    BETTER_AUTH_URL: "https://studio.example.com",
  };

  it("treats a completely empty environment as not configured", () => {
    const config = parseEmailConfig({});
    assert.equal(config.configured, false);
    assert.equal(config.configured === false && config.reason, "not_configured");
  });

  it("accepts a complete configuration", () => {
    const config = parseEmailConfig(valid);
    assert.equal(config.configured, true);
    if (!config.configured) return;
    assert.deepEqual(config.from, {
      address: "studio@example.com",
      name: "Studio",
    });
    assert.equal(config.adminRecipients.length, 1);
    assert.equal(config.appBaseUrl, "https://studio.example.com");
    assert.equal(config.replyTo, null);
  });

  it("rejects an invalid sender", () => {
    const config = parseEmailConfig({ ...valid, EMAIL_FROM: "not-an-address" });
    assert.equal(config.configured, false);
    assert.equal(config.configured === false && config.reason, "invalid");
    assert.ok(
      config.configured === false &&
        config.problems.some((problem) => problem.includes("EMAIL_FROM")),
    );
  });

  it("rejects an invalid admin recipient", () => {
    const config = parseEmailConfig({
      ...valid,
      EMAIL_ADMIN_RECIPIENTS: "studio@example.com, oops",
    });
    assert.equal(config.configured, false);
    assert.ok(
      config.configured === false &&
        config.problems.some((problem) =>
          problem.includes("EMAIL_ADMIN_RECIPIENTS"),
        ),
    );
  });

  it("treats a partial configuration as invalid rather than absent", () => {
    const config = parseEmailConfig({ EMAIL_FROM: valid.EMAIL_FROM });
    assert.equal(config.configured, false);
    assert.equal(config.configured === false && config.reason, "invalid");

    const replyOnly = parseEmailConfig({
      EMAIL_REPLY_TO: "replies@example.com",
    });
    assert.equal(replyOnly.configured, false);
    assert.equal(
      replyOnly.configured === false && replyOnly.reason,
      "invalid",
    );
  });

  it("rejects a malformed or non-origin admin-link base URL", () => {
    for (const BETTER_AUTH_URL of [
      "javascript:alert(1)",
      "https://studio.example.com/admin",
      "https://user:secret@studio.example.com",
      "https://studio.example.com/?next=evil",
    ]) {
      const config = parseEmailConfig({ ...valid, BETTER_AUTH_URL });
      assert.equal(config.configured, false, `accepted: ${BETTER_AUTH_URL}`);
    }
  });

  it("never reports configuration values, only variable names", () => {
    const config = parseEmailConfig({ ...valid, EMAIL_FROM: "bad" });
    assert.ok(config.configured === false);
    const joined = config.configured === false ? config.problems.join(" ") : "";
    assert.ok(!joined.includes("re_test_key"));
    assert.ok(!joined.includes("bad"));
  });
});

describe("email content", () => {
  it("builds the studio notification entirely from the snapshot", () => {
    const model = buildAdminNotification(inquiry, {
      adminUrl: "https://studio.example.com/admin/inquiries/abc",
    });
    const text = toPlainText(model);

    assert.equal(model.subject, "New inquiry — Wedding");
    for (const expected of [
      "Jane Smith",
      "jane@example.invalid",
      "+49 30 123456",
      "Studio A",
      "Wedding Photography",
      "Berlin",
      "EUR 3000+",
      "Instagram",
      "We would love to work with you.",
    ]) {
      assert.ok(text.includes(expected), `missing: ${expected}`);
    }
    assert.ok(text.includes("https://studio.example.com/admin/inquiries/abc"));
  });

  it("omits fields the visitor left empty", () => {
    const text = toPlainText(
      buildAdminNotification({
        ...inquiry,
        phoneSnapshot: null,
        companySnapshot: "   ",
        location: null,
      }),
    );
    assert.ok(!text.includes("Phone:"));
    assert.ok(!text.includes("Company:"));
    assert.ok(!text.includes("Location:"));
  });

  it("acknowledges the customer without promising a response time", () => {
    const model = buildCustomerAcknowledgment(inquiry, {
      studioName: "Example Studio",
    });
    const text = toPlainText(model);

    assert.equal(model.subject, "We received your inquiry");
    assert.ok(text.includes("Hello Jane Smith,"));
    assert.ok(text.includes("Example Studio"));
    // No commitment the business has not actually made.
    assert.ok(!/24 hours|business day|within \d/i.test(text));
    // No internal CRM vocabulary leaks to the visitor.
    assert.ok(!/\bCRM\b|pipeline|snapshot|status/i.test(text));
  });

  it("keeps the message body out of subjects and previews", () => {
    const hostile: InquirySnapshot = {
      ...inquiry,
      projectType: "Wedding\r\nBcc: evil@example.com",
      message: "SECRETMESSAGEBODY",
    };
    const admin = buildAdminNotification(hostile);
    const customer = buildCustomerAcknowledgment(hostile, {
      studioName: "Example Studio",
    });

    for (const value of [
      admin.subject,
      admin.preview,
      customer.subject,
      customer.preview,
    ]) {
      assert.ok(!value.includes("SECRETMESSAGEBODY"));
      assert.ok(!/[\r\n]/.test(value), "subject contains a line break");
    }
  });

  it("formats a date-only preferred date without shifting the day", () => {
    assert.equal(formatProjectDate(inquiry.projectDate!), "3 February 2027");
    assert.equal(
      formatSubmittedAt(new Date("2026-09-11T09:05:00.000Z")),
      "11 September 2026 at 09:05 UTC",
    );
  });

  it("produces plain text that carries the meaning without styling", () => {
    const text = toPlainText(
      buildCustomerAcknowledgment(inquiry, { studioName: "Example Studio" }),
    );
    assert.ok(text.includes("WHAT YOU SENT"));
    assert.ok(text.includes("YOUR MESSAGE"));
    assert.ok(text.trim().length > 80);
  });
});

describe("provider errors", () => {
  it("reduces provider failures to short safe codes", () => {
    assert.equal(toErrorCode({ name: "validation_error" }), "validation_error");
    assert.equal(toErrorCode({ name: "rate_limit_exceeded" }), "rate_limit_exceeded");
    // Anything unrecognised collapses rather than leaking a payload.
    assert.equal(
      toErrorCode({ name: "recipient jane@example.invalid rejected" }),
      "provider_error",
    );
    assert.equal(toErrorCode(new Error("boom")), "provider_error");
    assert.equal(toErrorCode("weird"), "provider_error");
  });
});
