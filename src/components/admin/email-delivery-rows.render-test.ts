import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// See turnstile-widget.render-test.ts: under tsx the classic JSX runtime needs `React` as a global.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

let EmailDeliveryRows: typeof import("@/components/admin/email-delivery-rows").EmailDeliveryRows;
before(async () => {
  ({ EmailDeliveryRows } = await import("@/components/admin/email-delivery-rows"));
});

const NOW = new Date("2026-11-01T12:00:00.000Z");
const ADMIN = "INQUIRY_ADMIN_NOTIFICATION" as const;
const CUSTOMER = "INQUIRY_CUSTOMER_ACKNOWLEDGMENT" as const;
type Status = "PROCESSING" | "ACCEPTED" | "FAILED" | "SKIPPED";

const row = (type: typeof ADMIN | typeof CUSTOMER, status: Status, minutesAgo = 0) => ({
  type, status, attemptCount: 1, lastErrorCode: null, sentAt: status === "ACCEPTED" ? NOW : null, updatedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
});
const render = (deliveries: ReturnType<typeof row>[], anonymized = false) =>
  renderToStaticMarkup(createElement(EmailDeliveryRows, { anonymized, deliveries, inquiryId: "id", now: NOW, recoverAction: async () => {}, retryAction: async () => {} }));
const count = (html: string, text: string) => html.split(text).length - 1;
function assertRequiredConfirmation(html: string) {
  const input = /<input[^>]*name="confirmDuplicateRisk"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(input, /type="checkbox"/);
  assert.match(input, /\brequired=""/);
  assert.match(input, /value="yes"/);
}

describe("email delivery recovery actions", () => {
  it("offers a retry for FAILED, warning about a duplicate, with no confirmation box", () => {
    const html = render([row(ADMIN, "FAILED"), row(CUSTOMER, "ACCEPTED")]);
    assert.equal(count(html, "Retry email"), 1);
    assert.match(html, /a retry sends a second email/);
    assert.equal(count(html, "confirmDuplicateRisk"), 0);
  });

  it("offers a plain retry for SKIPPED, since nothing was sent", () => {
    const html = render([row(ADMIN, "SKIPPED"), row(CUSTOMER, "SKIPPED")]);
    assert.equal(count(html, "Retry email"), 2);
    assert.doesNotMatch(html, /duplicate|second email/);
  });

  it("offers no retry for an active PROCESSING delivery", () => {
    const html = render([row(ADMIN, "PROCESSING", 1), row(CUSTOMER, "ACCEPTED")]);
    assert.match(html, /Sending/);
    assert.doesNotMatch(html, /<button/);
  });

  it("offers a required duplicate-risk confirmation for a stale PROCESSING delivery", () => {
    const html = render([row(ADMIN, "PROCESSING", 6), row(CUSTOMER, "ACCEPTED")]);
    assert.match(html, /may or may not have been sent/);
    assert.equal(count(html, "Retry email"), 1);
    assertRequiredConfirmation(html);
    assert.match(html, /may send a duplicate email/);
  });

  it("offers no action for ACCEPTED deliveries", () => {
    assert.doesNotMatch(render([row(ADMIN, "ACCEPTED"), row(CUSTOMER, "ACCEPTED")]), /<button/);
  });

  it("lists each missing delivery and offers one confirmed recovery", () => {
    const html = render([]);
    assert.match(html, /Studio notification/);
    assert.match(html, /Customer acknowledgment/);
    assert.equal(count(html, "No email has been attempted"), 2);
    assert.equal(count(html, "Send missing emails"), 1);
    assertRequiredConfirmation(html);
    assert.match(html, /may send a duplicate email/);
    assert.match(html, /would reach the visitor late/);
  });

  it("shows a recorded delivery beside a missing one", () => {
    const html = render([row(ADMIN, "ACCEPTED")]);
    assert.equal(count(html, "No email has been attempted"), 1);
    assert.equal(count(html, "Send missing emails"), 1);
  });

  it("offers no recovery of any kind for an anonymized inquiry", () => {
    for (const deliveries of [[], [row(ADMIN, "FAILED")], [row(ADMIN, "PROCESSING", 60)]]) {
      assert.doesNotMatch(render(deliveries, true), /<button/);
    }
  });
});
