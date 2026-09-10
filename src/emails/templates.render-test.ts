import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { render } from "@react-email/components";
import React from "react";

import { InquiryAdminEmail } from "@/emails/inquiry-admin";
import { InquiryCustomerEmail } from "@/emails/inquiry-customer";
import type { InquirySnapshot } from "@/emails/inquiry-content";

/**
 * React Email template rendering.
 *
 * Run by a separate `npm test` pass **without** the `react-server` export
 * condition, because `react-dom/server` refuses to load under it. Inside
 * Next.js the render happens in the ordinary server runtime, where it works —
 * this pass reproduces that environment rather than the RSC one.
 *
 * No provider is contacted and no key is required.
 */

const hostile: InquirySnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  createdAt: new Date("2026-09-11T09:05:00.000Z"),
  nameSnapshot: '<script>alert("xss")</script>',
  emailSnapshot: "jane@example.invalid",
  phoneSnapshot: "+49 30 123456",
  whatsappSnapshot: null,
  companySnapshot: '<img src=x onerror="alert(1)">',
  serviceNameSnapshot: "Wedding Photography",
  projectDate: new Date("2027-02-03T00:00:00.000Z"),
  projectType: "Wedding",
  location: "Berlin",
  budgetLabel: null,
  referralSource: null,
  message: "Line one\n\n<b>bold</b> & 'quoted' \"text\"",
};

describe("admin notification template", () => {
  it("renders the submitted snapshot as HTML and plain text", async () => {
    const element = React.createElement(InquiryAdminEmail, {
      inquiry: hostile,
      adminUrl: "https://studio.example.com/admin/inquiries/abc",
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });

    assert.ok(html.includes("New inquiry received"));
    assert.ok(html.includes("jane@example.invalid"));
    assert.ok(html.includes("Wedding Photography"));
    assert.ok(html.includes("https://studio.example.com/admin/inquiries/abc"));
    assert.ok(text.includes("jane@example.invalid"));
    assert.ok(text.includes("Line one"));
  });

  it("escapes untrusted visitor content rather than emitting markup", async () => {
    const html = await render(
      React.createElement(InquiryAdminEmail, {
        inquiry: hostile,
        adminUrl: null,
      }),
    );

    // The text is present, but never as live markup.
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("alert"));
  });

  it("omits the admin link when no base URL is configured", async () => {
    const html = await render(
      React.createElement(InquiryAdminEmail, {
        inquiry: hostile,
        adminUrl: null,
      }),
    );
    assert.ok(!html.includes("View inquiry in admin"));
  });
});

describe("customer acknowledgment template", () => {
  it("renders an acknowledgment addressed to the visitor", async () => {
    const element = React.createElement(InquiryCustomerEmail, {
      inquiry: { ...hostile, nameSnapshot: "Jane Smith" },
      studioName: "Example Studio",
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });

    assert.ok(html.includes("Thank you for getting in touch"));
    assert.ok(html.includes("Jane Smith"));
    assert.ok(html.includes("Example Studio"));
    assert.ok(text.includes("Hello Jane Smith,"));
  });

  it("carries no tracking pixel, script, or remote font", async () => {
    const html = await render(
      React.createElement(InquiryCustomerEmail, {
        inquiry: hostile,
        studioName: "Example Studio",
      }),
    );

    assert.ok(!/<script/i.test(html));
    assert.ok(!/<img/i.test(html), "no image, so no tracking pixel");
    assert.ok(!/fonts\.googleapis|@import|url\(/i.test(html));
  });

  it("never mentions internal CRM vocabulary to the visitor", async () => {
    const text = await render(
      React.createElement(InquiryCustomerEmail, {
        inquiry: { ...hostile, nameSnapshot: "Jane Smith" },
        studioName: "Example Studio",
      }),
      { plainText: true },
    );

    assert.ok(!/\bCRM\b|pipeline|snapshot|delivery record/i.test(text));
  });
});
