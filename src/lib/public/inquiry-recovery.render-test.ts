import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";

import {
  createInquirySubmitHandler,
  settleInquirySubmission,
  OUTDATED_AFTER_UNCONFIRMED_MESSAGE,
  OUTDATED_MESSAGE,
  UNCONFIRMED_MESSAGE,
  withUnconfirmedRecovery,
  type ClientInquiryState,
  type InquiryOutcome,
  type UnconfirmedCause,
} from "@/lib/public/inquiry-form";
import { nextSubmissionToken, SUBMISSION_TOKEN_FIELD } from "@/lib/security/submission-token";
import { notFound, redirect, unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";
// The variant Next.js ships to browsers, which is the one the form runs.
import { unstable_rethrow as browserRethrow } from "next/dist/client/components/unstable-rethrow.browser";
// What the Next.js client throws when the server no longer knows the action.
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

// Runs in the pass without the `react-server` condition: under it,
// `next/navigation` resolves to client router code that cannot load, and the
// form imports it as client code anyway.
/**
 * Phase 10D-2A-R4: a thrown server action leaves the outcome unknown, so the
 * form must keep its values and its submission token for a deliberate retry.
 *
 * These are unit tests of the wrapper, the settle step and the submit handler
 * the form composes. The mounted lifecycle is covered by
 * `src/components/public/inquiry-form.render-test.ts`.
 */
const TOKEN = "3f1c2a7e-8b4d-4e6f-9a1b-2c3d4e5f6a7b";

function captured(run: () => never): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail("expected the framework helper to throw");
}

function recoveryHarness(answers: (() => Promise<ClientInquiryState>)[], report?: (error: unknown, cause: UnconfirmedCause) => void) {
  const calls: { previous: ClientInquiryState; form: FormData }[] = [];
  const reports: { error: unknown; cause: UnconfirmedCause }[] = [];
  const recovered = withUnconfirmedRecovery(async (previous, form) => {
    calls.push({ previous, form });
    const answer = answers[calls.length - 1];
    assert.ok(answer, "the action was called more often than the visitor submitted");
    return answer();
  }, {
    isUnrecognizedAction: unstable_isUnrecognizedActionError,
    report: report ?? ((error, cause) => void reports.push({ error, cause })),
    rethrowFrameworkError: browserRethrow,
  });

  const inFlight = { current: false };
  const form = new FormData();
  form.set(SUBMISSION_TOKEN_FIELD, TOKEN);
  form.set("name", "Visitor");
  form.set("message", "A message long enough to pass.");
  const pending: Promise<ClientInquiryState>[] = [];
  let state: ClientInquiryState = { success: false };
  const submit = createInquirySubmitHandler({
    dispatch: (data) => void pending.push(recovered(state, data)),
    inFlight,
    readForm: () => form,
    startTransition: (callback) => callback(),
  });
  const event = { preventDefault: () => {}, currentTarget: {} as HTMLFormElement };
  // Mirrors the form: await the answer, then run the settle step its effect runs.
  async function answer() {
    state = await pending.at(-1)!;
    return settleInquirySubmission(state, inFlight);
  }
  return { answer, calls, form, inFlight, pending, reports, state: () => state, submit: () => submit(event) };
}

const transportFailure = () => Promise.reject(new TypeError("Failed to fetch"));

describe("unconfirmed submission recovery", () => {
  it("turns a transport failure into a distinct unconfirmed state", async () => {
    const h = recoveryHarness([transportFailure]);
    h.submit();
    assert.equal(await h.answer(), "unconfirmed");
    assert.deepEqual(h.state(), { success: false, unconfirmed: true, message: UNCONFIRMED_MESSAGE });
  });

  it("treats error responses as unconfirmed too", async () => {
    const h = recoveryHarness([() => Promise.reject(new Error("An unexpected response was received from the server."))]);
    h.submit();
    assert.equal(await h.answer(), "unconfirmed");
  });

  it("answers an action the server no longer knows as outdated, not unconfirmed", async () => {
    const h = recoveryHarness([() => Promise.reject(new UnrecognizedActionError('Server Action "abc" was not found on the server.'))]);
    h.submit();
    assert.equal(await h.answer(), "outdated");
    assert.deepEqual(h.state(), { success: false, outdated: true, message: OUTDATED_MESSAGE });
    assert.equal(h.inFlight.current, false);
  });

  it("keeps a first indeterminate attempt plainly unconfirmed, with no history yet", async () => {
    const h = recoveryHarness([transportFailure]);
    h.submit();
    assert.equal(await h.answer(), "unconfirmed");
    assert.equal(h.state().priorUnconfirmed, undefined);
  });

  describe("after an unconfirmed attempt", () => {
    const unknownAction = () => Promise.reject(new UnrecognizedActionError('Server Action "abc" was not found on the server.'));

    it("an outdated retry keeps the earlier attempt's uncertainty instead of saying nothing was sent", async () => {
      const h = recoveryHarness([transportFailure, unknownAction]);
      h.submit();
      assert.equal(await h.answer(), "unconfirmed");
      h.submit();
      assert.equal(await h.answer(), "outdated");
      assert.deepEqual(h.state(), { success: false, outdated: true, message: OUTDATED_AFTER_UNCONFIRMED_MESSAGE, priorUnconfirmed: true });
      assert.doesNotMatch(h.state().message!, /hasn't been sent/);
      assert.deepEqual(h.reports.map((r) => r.cause), ["indeterminate", "unrecognized-action"]);
      assert.equal(h.calls.length, 2);
      assert.equal(h.calls[1]!.form.get(SUBMISSION_TOKEN_FIELD), TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(h.calls.length, 2, "nothing retries on its own");
    });

    it("a definite failure in between does not clear the uncertainty", async () => {
      // The failed retry only shows the inquiry was not stored when it checked;
      // the earlier request may still have been running.
      const turnstileFailure: ClientInquiryState = { success: false, message: "Verification failed. Please try again." };
      const h = recoveryHarness([transportFailure, () => Promise.resolve(turnstileFailure), unknownAction]);
      h.submit();
      await h.answer();
      h.submit();
      assert.equal(await h.answer(), "failure");
      assert.deepEqual(h.state(), { ...turnstileFailure, priorUnconfirmed: true });
      h.submit();
      assert.equal(await h.answer(), "outdated");
      assert.equal(h.state().message, OUTDATED_AFTER_UNCONFIRMED_MESSAGE);
    });

    it("a successful replay still succeeds", async () => {
      const h = recoveryHarness([transportFailure, () => Promise.resolve({ success: true, message: "Thank you. Your inquiry has been received." })]);
      h.submit();
      await h.answer();
      h.submit();
      assert.equal(await h.answer(), "success");
      assert.equal(h.calls[1]!.form.get(SUBMISSION_TOKEN_FIELD), TOKEN);
    });
  });

  it("reports every recovered error, classified only through Next.js's public helper", async () => {
    const unrecognized = new UnrecognizedActionError('Server Action "abc" was not found on the server.');
    // Same message, but not the framework's error: text is never the signal.
    const lookalike = new Error('Server Action "abc" was not found on the server.');
    const programming = new TypeError("Cannot read properties of undefined (reading 'x')");
    const expected: [unknown, UnconfirmedCause, InquiryOutcome][] = [
      [unrecognized, "unrecognized-action", "outdated"],
      [lookalike, "indeterminate", "unconfirmed"],
      [programming, "indeterminate", "unconfirmed"],
      [new TypeError("Failed to fetch"), "indeterminate", "unconfirmed"],
      ["not an Error", "indeterminate", "unconfirmed"],
    ];
    for (const [error, cause, outcome] of expected) {
      const h = recoveryHarness([() => Promise.reject(error)]);
      h.submit();
      assert.equal(await h.answer(), outcome, String(error));
      assert.deepEqual(h.reports, [{ error, cause }], String(error));
    }
  });

  it("reports nothing for returned outcomes or framework control flow", async () => {
    const h = recoveryHarness([() => Promise.resolve({ success: false, message: "Verification failed. Please try again." })]);
    h.submit();
    await h.answer();
    const frameworkError = captured(() => redirect("/elsewhere"));
    const r = recoveryHarness([() => Promise.reject(frameworkError)]);
    r.submit();
    await assert.rejects(r.pending[0]!);
    assert.deepEqual([...h.reports, ...r.reports], []);
  });

  it("keeps the visitor's form when the reporter itself fails, and surfaces that failure separately", async () => {
    const reporterBug = new Error("reporter defect");
    // Captured rather than run: the test runner would fail on the throw.
    const scheduled = mock.method(globalThis, "queueMicrotask", () => {});
    try {
      const h = recoveryHarness([transportFailure], () => {
        throw reporterBug;
      });
      h.submit();
      assert.equal(await h.answer(), "unconfirmed");
      assert.equal(scheduled.mock.callCount(), 1);
      assert.throws(() => scheduled.mock.calls[0]!.arguments[0]!(), (error) => error === reporterBug);
    } finally {
      scheduled.mock.restore();
    }
  });

  it("keeps ordinary returned failures distinct and unchanged", async () => {
    const validation: ClientInquiryState = { success: false, message: "Please check the highlighted fields.", errors: { email: ["Enter a valid email address."] } };
    const h = recoveryHarness([() => Promise.resolve(validation)]);
    h.submit();
    assert.equal(await h.answer(), "failure");
    assert.equal(h.state(), validation, "the returned state passes through untouched");
    assert.equal(h.state().unconfirmed, undefined);
  });

  it("does not retry on its own: one action call per visitor submission", async () => {
    const h = recoveryHarness([transportFailure]);
    h.submit();
    await h.answer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.calls.length, 1);
  });

  it("releases the duplicate-submit guard once the attempt is unconfirmed", async () => {
    const h = recoveryHarness([transportFailure]);
    h.submit();
    h.submit();
    assert.equal(h.pending.length, 1, "a second submit while pending is still dropped");
    await h.answer();
    assert.equal(h.inFlight.current, false);
  });

  it("retries deliberately with the same values and the same token, and can then succeed", async () => {
    const h = recoveryHarness([transportFailure, () => Promise.resolve({ success: true, message: "Thank you. Your inquiry has been received." })]);
    h.submit();
    assert.equal(await h.answer(), "unconfirmed");
    const before = [...h.form.entries()];

    h.submit();
    assert.equal(await h.answer(), "success");
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1]!.form, h.calls[0]!.form, "the retry reads the same, still-mounted form");
    assert.equal(h.calls[1]!.form.get(SUBMISSION_TOKEN_FIELD), TOKEN, "the replay lookup needs the original token");
    assert.deepEqual([...h.form.entries()], before, "nothing the visitor entered was altered");
  });

  it("issues no new token: recovery resolves, so nothing remounts the token's owner", async () => {
    const h = recoveryHarness([transportFailure]);
    h.submit();
    await assert.doesNotReject(h.pending[0]!, "a rejection would reach the error boundary, whose remount issues a new token");
    assert.equal(nextSubmissionToken(TOKEN), TOKEN, "a mounted form keeps the token it already holds");
  });

  it("lets Next.js redirect and not-found errors through", async () => {
    for (const make of [() => redirect("/elsewhere"), () => notFound()]) {
      const frameworkError = captured(make);
      const h = recoveryHarness([() => Promise.reject(frameworkError)]);
      h.submit();
      await assert.rejects(h.pending[0]!, (error) => error === frameworkError);
    }
  });

  it("uses a rethrow helper that throws framework errors and passes transport errors", () => {
    for (const rethrow of [browserRethrow, unstable_rethrow]) {
      const frameworkError = captured(() => redirect("/elsewhere"));
      assert.throws(() => rethrow(frameworkError), (error) => error === frameworkError);
      assert.doesNotThrow(() => rethrow(new TypeError("Failed to fetch")));
    }
  });

  it("is wired into the form with Next.js's public rethrow helper", () => {
    const source = readFileSync("src/components/public/inquiry-form.tsx", "utf8");
    assert.match(source, /import \{ unstable_isUnrecognizedActionError, unstable_rethrow \} from "next\/navigation"/);
    assert.match(source, /withUnconfirmedRecovery\(submitInquiry, \{\s*isUnrecognizedAction: unstable_isUnrecognizedActionError,\s*report: reportUnconfirmedSubmission,\s*rethrowFrameworkError: unstable_rethrow,\s*\}\)/);
    assert.match(source, /<InquiryFormView [^>]*submitAction=\{submitWithRecovery\}/);
  });
});
