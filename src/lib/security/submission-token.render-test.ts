import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { inquirySchema } from "@/lib/validation/crm";
import {
  SUBMISSION_TOKEN_FIELD,
  nextSubmissionToken,
  useSubmissionToken,
} from "@/lib/security/submission-token";

/**
 * Regression coverage for the submission-token hydration defect.
 *
 * `/contact` is statically prerendered with `revalidate = 3600`. A token
 * produced during rendering is therefore baked into a cache entry that every
 * visitor shares for an hour — so the second visitor's submission is answered
 * from the replay branch as a success that was never recorded — and it is a
 * hydration mismatch besides, because the server and the client generate
 * different values for the same attribute.
 *
 * The invariant is observable in server markup: the token field must be
 * rendered **empty**. This pass runs without the `react-server` export
 * condition, because `react-dom/server` refuses to load under it.
 */

// `tsconfig.json` sets `"jsx": "preserve"`, because Next.js owns the JSX
// transform. Outside Next.js, tsx/esbuild falls back to the classic runtime and
// emits bare `React.createElement` calls, so component JSX needs `React` as a
// global. Next.js itself never uses this path.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The form's exact token wiring: hidden field plus the submit gate. */
function Probe() {
  const submissionToken = useSubmissionToken();
  return React.createElement(
    "form",
    null,
    React.createElement("input", { name: SUBMISSION_TOKEN_FIELD, type: "hidden", value: submissionToken }),
    React.createElement("button", { disabled: !submissionToken }, "Send inquiry"),
  );
}

describe("submission token server markup", () => {
  const markup = () => renderToStaticMarkup(React.createElement(Probe));

  it("bakes no generated token into server-rendered, cacheable HTML", () => {
    const html = markup();
    assert.ok(!UUID.test(html), `a token value reached server markup: ${html}`);
    assert.match(html, new RegExp(`name="${SUBMISSION_TOKEN_FIELD}"[^>]*value=""`));
  });

  it("generates only after mount, so the value is identical on both sides of hydration", () => {
    // Effects never run during server rendering, so two independent renders
    // are byte-identical. A render-time generator would differ here, which is
    // exactly the mismatch the browser saw.
    assert.equal(markup(), markup());
  });

  it("cannot submit while the token is absent", () => {
    assert.match(markup(), /<button disabled=""/, "the submit control is gated on an issued token");
  });
});

describe("submission token issuance", () => {
  it("issues a token the server schema accepts", () => {
    const issued = nextSubmissionToken("");
    assert.match(issued, UUID);
    assert.equal(inquirySchema.shape.submissionToken.safeParse(issued).success, true);
    // The pre-hydration value must never be accepted as a submission.
    assert.equal(inquirySchema.shape.submissionToken.safeParse("").success, false);
  });

  it("stays stable across re-renders, repeated effects and a retried submission", () => {
    const issued = nextSubmissionToken("");
    assert.equal(nextSubmissionToken(issued), issued);
    assert.equal(nextSubmissionToken(nextSubmissionToken(issued)), issued);
  });

  it("issues a fresh token whenever there is none to keep", () => {
    assert.notEqual(nextSubmissionToken(""), nextSubmissionToken(""));
  });
});

describe("inquiry form token wiring", () => {
  // The form itself cannot be rendered here: it imports the server action,
  // which reaches `server-only` and refuses to load outside the react-server
  // condition. These assert the three lines that connect it to the contract
  // proven above.
  const source = () => readFile("src/components/public/inquiry-form.tsx", "utf8");

  it("never generates a token during rendering", async () => {
    const text = await source();
    assert.ok(!text.includes("randomUUID"), "render-time generation is the defect itself");
    assert.match(text, /useSubmissionToken\(\)/);
  });

  it("submits the issued token and gates the submit control on it", async () => {
    const text = await source();
    assert.match(text, new RegExp(`name=\\{SUBMISSION_TOKEN_FIELD\\}[^>]*value=\\{submissionToken\\}`));
    assert.match(text, /disabled=\{pending \|\| !submissionToken\}/);
  });
});
