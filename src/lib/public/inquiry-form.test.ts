import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInquirySubmitHandler,
  INQUIRY_FIELDS,
  INQUIRY_INPUT_FIELDS,
  inquiryCopyText,
  inquiryErrorId,
  inquiryErrorItems,
  inquiryFieldId,
  settleInquirySubmission,
} from "@/lib/public/inquiry-form";
import { inquirySchema } from "@/lib/validation/crm";

/**
 * Phase 10D-2A inquiry form reliability.
 *
 * React 19 resets every uncontrolled field of a `<form action={fn}>` before it
 * runs the action, whatever the outcome, so a validation, Turnstile or server
 * failure used to clear the visitor's message. The form now submits through
 * this handler, which opts out of that reset.
 */

function harness() {
  const dispatched: FormData[] = [];
  const transitions: number[] = [];
  const inFlight = { current: false };
  const formData = new FormData();
  formData.set("message", "A long enough message");
  const handler = createInquirySubmitHandler({
    dispatch: (data) => void dispatched.push(data),
    inFlight,
    readForm: () => formData,
    startTransition: (callback) => {
      transitions.push(1);
      callback();
    },
  });
  let prevented = 0;
  const event = { preventDefault: () => void prevented++, currentTarget: {} as HTMLFormElement };
  return { dispatched, event, formData, handler, inFlight, prevented: () => prevented, transitions };
}

describe("inquiry submit handler", () => {
  it("prevents the native submit, so React never queues its form reset", () => {
    const h = harness();
    h.handler(h.event);
    assert.equal(h.prevented(), 1);
  });

  it("dispatches the form data once, inside a transition", () => {
    const h = harness();
    h.handler(h.event);
    assert.equal(h.transitions.length, 1, "useActionState requires a transition outside a form action");
    assert.deepEqual(h.dispatched, [h.formData]);
  });

  it("drops a second submit while the first is in flight", () => {
    const h = harness();
    h.handler(h.event);
    h.handler(h.event);
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.prevented(), 2, "the duplicate must not fall through to a native submit either");
  });

  // That the mounted form submits through this handler and settles with
  // `settleInquirySubmission` is shown by behaviour, not source, in
  // `src/components/public/inquiry-form.render-test.ts`.
});

describe("inquiry submission settling", () => {
  const failures = [
    { success: false, message: "Please check the highlighted fields.", errors: { email: ["Enter a valid email address."] } },
    { success: false, message: "Verification failed. Please try again." },
    { success: false, message: "We could not receive your inquiry. Please try again." },
  ];

  it("releases the guard after every kind of failure and asks for the summary", () => {
    for (const state of failures) {
      const inFlight = { current: true };
      assert.equal(settleInquirySubmission(state, inFlight), "failure", state.message);
      assert.equal(inFlight.current, false, state.message);
    }
  });

  it("releases the guard after a success and asks for the confirmation instead", () => {
    const inFlight = { current: true };
    assert.equal(settleInquirySubmission({ success: true, message: "Thank you." }, inFlight), "success");
    assert.equal(inFlight.current, false);
  });

  it("does nothing visible for the initial state", () => {
    const inFlight = { current: false };
    assert.equal(settleInquirySubmission({ success: false }, inFlight), "idle");
  });

  it("lets a failed attempt be retried to success, one dispatch per attempt", () => {
    // Plays the component's cycle: submit, the action answers, the effect
    // settles, the visitor submits again.
    const h = harness();
    h.handler(h.event);
    h.handler(h.event);
    assert.equal(h.dispatched.length, 1, "a second submit while the first is pending is dropped");

    assert.equal(settleInquirySubmission(failures[1]!, h.inFlight), "failure");
    h.handler(h.event);
    assert.equal(h.dispatched.length, 2, "the retry is dispatched after the failure settles");
    assert.equal(h.dispatched[1], h.formData, "the retry submits the same, still-entered values");

    assert.equal(settleInquirySubmission({ success: true, message: "Thank you." }, h.inFlight), "success");
    assert.equal(h.inFlight.current, false);
  });

  it("stays locked if an answer is never settled", () => {
    const h = harness();
    h.handler(h.event);
    h.handler(h.event);
    h.handler(h.event);
    assert.equal(h.dispatched.length, 1);
  });
});

describe("inquiry fields", () => {
  it("names only fields the server schema validates", () => {
    const schemaKeys = Object.keys(inquirySchema.shape);
    for (const field of INQUIRY_FIELDS) assert.ok(schemaKeys.includes(field.name), field.name);
  });

  it("gives every field a unique, stable id and error id", () => {
    const ids = INQUIRY_FIELDS.flatMap((field) => [inquiryFieldId(field.name), inquiryErrorId(field.name)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(inquiryFieldId("email"), "inquiry-email");
    assert.equal(inquiryErrorId("email"), "inquiry-email-error");
  });

  it("uses telephone inputs and personal-data autocomplete tokens", () => {
    const byName = Object.fromEntries(INQUIRY_INPUT_FIELDS.map((field) => [field.name, field]));
    assert.equal(byName.phone?.type, "tel");
    assert.equal(byName.whatsapp?.type, "tel");
    assert.equal(byName.name?.autoComplete, "name");
    assert.equal(byName.email?.autoComplete, "email");
    assert.equal(byName.phone?.autoComplete, "tel");
    assert.equal(byName.company?.autoComplete, "organization");
  });
});

describe("inquiry error summary items", () => {
  it("lists visible field errors in display order, first message only", () => {
    const items = inquiryErrorItems({
      message: ["Please add a little more detail."],
      name: ["Enter your name.", "second"],
      email: ["Enter a valid email address."],
    });
    assert.deepEqual(items.map((item) => item.name), ["name", "email", "message"]);
    assert.equal(items[0]?.message, "Enter your name.");
    assert.equal(items[0]?.fieldId, "inquiry-name");
  });

  it("omits hidden fields the visitor cannot correct", () => {
    assert.deepEqual(inquiryErrorItems({ submissionToken: ["Invalid uuid"], website: ["Too long"] }), []);
  });

  it("is empty without field errors", () => {
    assert.deepEqual(inquiryErrorItems(undefined), []);
  });
});

describe("inquiry copy text", () => {
  const entries: Record<string, string> = {
    name: "Test Visitor",
    email: "visitor@example.test",
    phone: "  ",
    serviceSlug: "Weddings",
    message: "First line.\nSecond line.",
    // Present in the form, never visible: none may be copied.
    submissionToken: "3f1c2a7e-8b4d-4e6f-9a1b-2c3d4e5f6a7b",
    "cf-turnstile-response": "challenge-response",
    website: "honeypot",
  };

  it("lists visible fields by label, in display order, with the message last", () => {
    assert.equal(
      inquiryCopyText((name) => entries[name]),
      "Full name: Test Visitor\nEmail address: visitor@example.test\nService: Weddings\nMessage / project description:\nFirst line.\nSecond line.",
    );
  });

  it("reads only the visible fields, so hidden security fields cannot be copied", () => {
    const read: string[] = [];
    const text = inquiryCopyText((name) => {
      read.push(name);
      return entries[name];
    });
    assert.deepEqual(read, INQUIRY_FIELDS.map((field) => field.name));
    for (const secret of ["3f1c2a7e", "challenge-response", "honeypot"]) assert.ok(!text.includes(secret), secret);
  });

  it("is empty when nothing was entered", () => {
    assert.equal(inquiryCopyText(() => undefined), "");
  });
});
