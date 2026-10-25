import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  InquiryConfirmation,
  InquiryErrorSummary,
  InquiryInput,
  InquirySelect,
  InquiryTextarea,
  InquiryUnconfirmedSummary,
} from "@/components/public/inquiry-fields";
import { INQUIRY_INPUT_FIELDS, INQUIRY_MESSAGE_FIELD, INQUIRY_SERVICE_FIELD } from "@/lib/public/inquiry-form";

/**
 * Phase 10D-2A inquiry field accessibility, observable in server markup.
 * Runs without the `react-server` condition, like the other render tests.
 */

// See turnstile-widget.render-test.ts for why `React` must be a global here.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const emailField = INQUIRY_INPUT_FIELDS.find((field) => field.name === "email")!;
const phoneField = INQUIRY_INPUT_FIELDS.find((field) => field.name === "phone")!;

describe("inquiry field markup", () => {
  it("labels the control explicitly, without the error text in its name", () => {
    const html = render(React.createElement(InquiryInput, { error: "Enter a valid email address.", field: emailField }));
    assert.match(html, /<label for="inquiry-email">Email<span aria-hidden="true"> \*<\/span><\/label>/);
    assert.doesNotMatch(html, /<label[^>]*>[^]*Enter a valid[^]*<\/label>/);
  });

  it("describes an invalid control by its error and marks it invalid", () => {
    const html = render(React.createElement(InquiryInput, { error: "Enter a valid email address.", field: emailField }));
    assert.match(html, /<input[^>]*aria-describedby="inquiry-email-error"/);
    assert.match(html, /<input[^>]*aria-invalid="true"/);
    assert.match(html, /<span[^>]*id="inquiry-email-error"[^>]*>Enter a valid email address\.<\/span>/);
  });

  it("leaves a valid control undescribed and not invalid", () => {
    const html = render(React.createElement(InquiryInput, { field: emailField }));
    assert.doesNotMatch(html, /aria-describedby|aria-invalid/);
    assert.match(html, /autoComplete="email"|autocomplete="email"/);
  });

  it("renders the phone field as a telephone input", () => {
    const html = render(React.createElement(InquiryInput, { field: phoneField }));
    assert.match(html, /type="tel"/);
    assert.match(html, /autocomplete="tel"/i);
  });

  it("never renders a value, so nothing submitted is written back into markup", () => {
    const html = render(React.createElement(InquiryInput, { error: "x", field: emailField }));
    assert.doesNotMatch(html, /\svalue=/);
  });

  it("associates select and textarea errors the same way", () => {
    const select = render(React.createElement(InquirySelect, { error: "Unknown service.", field: INQUIRY_SERVICE_FIELD }, React.createElement("option", { value: "" }, "Not sure yet")));
    assert.match(select, /<select[^>]*aria-describedby="inquiry-serviceSlug-error"[^>]*aria-invalid="true"/);
    assert.match(select, /id="inquiry-serviceSlug-error"/);
    const textarea = render(React.createElement(InquiryTextarea, { error: "Please add a little more detail.", field: INQUIRY_MESSAGE_FIELD }));
    assert.match(textarea, /<textarea[^>]*aria-describedby="inquiry-message-error"[^>]*aria-invalid="true"/);
    assert.match(textarea, /id="inquiry-message-error"/);
  });

  it("keeps every control and its label clear of the sticky header when focused", () => {
    const controls = [
      render(React.createElement(InquiryInput, { field: emailField })),
      render(React.createElement(InquirySelect, { field: INQUIRY_SERVICE_FIELD })),
      render(React.createElement(InquiryTextarea, { field: INQUIRY_MESSAGE_FIELD })),
    ];
    for (const html of controls) {
      const control = /<(input|select|textarea)[^>]*>/.exec(html)?.[0] ?? "";
      assert.match(control, /scroll-mt-\[calc\(var\(--header-height\)\+2rem\)\]/, control);
    }
  });

  it("keeps a field at its own height beside a taller neighbour", () => {
    assert.match(render(React.createElement(InquiryInput, { field: emailField })), /^<div class="grid content-start /);
  });

  it("gives invalid controls a visible boundary change", () => {
    const html = render(React.createElement(InquiryInput, { field: emailField }));
    assert.match(html, /border-input/);
    assert.match(html, /aria-\[invalid=true\]:border-red-400/);
  });
});

describe("inquiry error summary", () => {
  const summary = () => render(React.createElement(InquiryErrorSummary, {
    errors: { email: ["Enter a valid email address."], submissionToken: ["Invalid uuid"] },
    message: "Please check the highlighted fields.",
  }));

  it("is a focusable group with a fixed name, described once by the message", () => {
    const html = summary();
    const container = /^<div[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(container, /role="group"/);
    assert.match(container, /tabindex="-1"/i);
    assert.match(container, /aria-label="Inquiry not sent"/);
    assert.match(container, /aria-describedby="inquiry-error-summary-message"/);
    assert.doesNotMatch(container, /aria-labelledby/, "the message must not be both the name and the description");
    assert.doesNotMatch(html, /role="alert"/, "focus already announces it");
    assert.match(html, /id="inquiry-error-summary-message"[^>]*>Please check the highlighted fields\./);
  });

  it("clears the sticky header when focus scrolls it into view", () => {
    const container = /^<div[^>]*>/.exec(summary())?.[0] ?? "";
    assert.match(container, /scroll-mt-\[calc\(var\(--header-height\)\+2rem\)\]/);
  });

  it("links each visible field error to its control", () => {
    const html = summary();
    assert.match(html, /<a[^>]*href="#inquiry-email"[^>]*>Email: Enter a valid email address\.<\/a>/);
    assert.doesNotMatch(html, /submissionToken/);
  });

  it("renders the message alone for a failure with no field errors", () => {
    const html = render(React.createElement(InquiryErrorSummary, { message: "Verification failed. Please try again." }));
    assert.doesNotMatch(html, /<ul/);
    assert.match(html, /Verification failed/);
  });
});

describe("inquiry unconfirmed summary", () => {
  const html = (disabled = false) => render(React.createElement(InquiryUnconfirmedSummary, { disabled }));
  const container = (markup: string) => /^<div[^>]*>/.exec(markup)?.[0] ?? "";

  it("uses the approved heading, message and retry wording", () => {
    const markup = html();
    assert.match(markup, /<h3[^>]*>We couldn(?:&#x27;|')t confirm your inquiry<\/h3>/);
    assert.match(markup, /Your message may have been received, but we couldn(?:&#x27;|')t confirm it\. Your details are still here\. Please check your connection and try sending again\./);
    assert.match(markup, /<button[^>]*type="submit"[^>]*>Try sending again<\/button>/);
  });

  it("is a focusable group named by its heading and described by its message", () => {
    const div = container(html());
    assert.match(div, /role="group"/);
    assert.match(div, /tabindex="-1"/i);
    assert.match(div, /aria-labelledby="inquiry-unconfirmed-title"/);
    assert.match(div, /aria-describedby="inquiry-unconfirmed-message"/);
    assert.doesNotMatch(html(), /role="alert"|aria-live/, "focus announces it once");
  });

  it("is distinct from the failure summary, which says the inquiry was not sent", () => {
    assert.match(container(html()), /id="inquiry-unconfirmed-summary"/);
    assert.doesNotMatch(html(), /Inquiry not sent|inquiry-error-summary/);
  });

  it("clears the sticky header when focus scrolls it into view", () => {
    assert.match(container(html()), /scroll-mt-\[calc\(var\(--header-height\)\+2rem\)\]/);
  });

  it("disables the retry while a submission is pending or the token is not ready", () => {
    assert.match(html(true), /<button[^>]*disabled=""/);
    assert.doesNotMatch(html(false), /disabled=""/);
  });
});

describe("inquiry confirmation", () => {
  const html = () => render(React.createElement(InquiryConfirmation, { message: "Thank you. Your inquiry has been received." }));

  it("keeps the existing heading and message copy", () => {
    assert.match(html(), /<h2[^>]*>Inquiry received<\/h2>/);
    assert.match(html(), /Thank you\. Your inquiry has been received\./);
  });

  it("makes the heading a script focus target without adding a Tab stop", () => {
    const heading = /<h2[^>]*>/.exec(html())?.[0] ?? "";
    assert.match(heading, /tabindex="-1"/i);
  });

  it("clears the sticky header when focus scrolls it into view", () => {
    const heading = /<h2[^>]*>/.exec(html())?.[0] ?? "";
    assert.match(heading, /scroll-mt-\[calc\(var\(--header-height\)\+2rem\)\]/);
  });

  it("does not also announce itself as a live region, which focus already covers", () => {
    assert.doesNotMatch(html(), /role="status"|aria-live/);
  });
});

describe("form control boundary contrast", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const token = (name: string) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css);
    assert.ok(match, `--${name} is defined`);
    return match[1]!;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it("meets 3:1 against every surface the form can sit on", () => {
    for (const surface of ["background", "surface", "surface-strong"]) {
      assert.ok(contrast(token("input"), token(surface)) >= 3, `--input on --${surface}`);
    }
  });

  // The token above only matters if `border-input` reaches the control. An
  // unlayered element rule (such as `* { border-color }`) beats every Tailwind
  // utility regardless of specificity, which once rendered these borders at
  // 1.5:1 while this file still passed. Outside `@layer`, `@theme` and `@media`
  // blocks, only `:root` and class selectors may appear.
  it("keeps element defaults in a layer, so utilities can override them", () => {
    let depth = 0;
    let top = "";
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
      if (char === "{") depth++;
      if (depth === 0) top += char;
      if (char === "}") { depth--; if (depth === 0) top += "{}"; }
    }
    const selectors = top.split("{}").map((part) => part.replace(/@import[^;]*;/g, "").trim()).filter(Boolean);
    const offending = selectors.filter((selector) => !selector.startsWith("@") && selector.split(",").some((s) => { const t = s.trim(); return t !== ":root" && !t.startsWith("."); }));
    assert.deepEqual(offending, []);
  });
});
