import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { JSDOM } from "jsdom";
import { unstable_isUnrecognizedActionError } from "next/navigation";
// The variant Next.js ships to browsers, which is the one the form runs.
import { unstable_rethrow as browserRethrow } from "next/dist/client/components/unstable-rethrow.browser";

// What the Next.js client throws when the server no longer knows the action.
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

import type { InquiryFormState } from "@/app/(public)/contact/actions";
import type { InquiryFormView as InquiryFormViewType } from "@/components/public/inquiry-form-view";
import {
  OUTDATED_AFTER_UNCONFIRMED_HEADING,
  OUTDATED_AFTER_UNCONFIRMED_MESSAGE,
  OUTDATED_COPY_FAILURE,
  OUTDATED_COPY_LABEL,
  OUTDATED_COPY_SUCCESS,
  OUTDATED_HEADING,
  OUTDATED_MESSAGE,
  type UnconfirmedCause,
  UNCONFIRMED_HEADING,
  UNCONFIRMED_RETRY_LABEL,
  withUnconfirmedRecovery,
} from "@/lib/public/inquiry-form";
import { SUBMISSION_TOKEN_FIELD } from "@/lib/security/submission-token";
import { TURNSTILE_RESPONSE_FIELD, type TurnstileRenderOptions } from "@/lib/security/turnstile-widget";

/**
 * Phase 10D-2A-R6: the inquiry form mounted with React DOM in jsdom, driven
 * through real form submission, with the server action, Turnstile and the
 * token source replaced. Nothing here reaches a database, Cloudflare or an
 * email provider.
 *
 * The form under test is `InquiryFormView` composed with the real
 * `withUnconfirmedRecovery` and Next.js's browser helpers, exactly as
 * `InquiryForm` composes it with the real server action.
 */
const TOKEN = "3f1c2a7e-8b4d-4e6f-9a1b-2c3d4e5f6a7b";
const SUCCESS: InquiryFormState = { success: true, message: "Thank you. Your inquiry has been received." };
const VALIDATION: InquiryFormState = { success: false, message: "Please check the highlighted fields.", errors: { email: ["Enter a valid email address."] } };
// Placeholder values only.
const VALUES = { name: "Test Visitor", email: "visitor@example.test", projectType: "Wedding film", message: "A test message that is long enough to pass." };

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/contact", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let InquiryFormView: typeof InquiryFormViewType;

before(async () => {
  const globals: Globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  // Loaded after the globals exist: React DOM detects the DOM when it loads.
  const React = await import("react");
  ({ act, createElement } = React);
  // See turnstile-widget.render-test.ts for why `React` must be a global here.
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ InquiryFormView } = await import("@/components/public/inquiry-form-view"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

type Deferred = { resolve: (state: InquiryFormState) => void; reject: (error: unknown) => void };

function harness() {
  const calls: Record<string, FormDataEntryValue>[] = [];
  const answers: Deferred[] = [];
  const reports: { error: unknown; cause: UnconfirmedCause }[] = [];
  const submitAction = withUnconfirmedRecovery(
    (_previous, form) => {
      calls.push(Object.fromEntries(form));
      return new Promise<InquiryFormState>((resolve, reject) => void answers.push({ resolve, reject }));
    },
    { isUnrecognizedAction: unstable_isUnrecognizedActionError, report: (error, cause) => void reports.push({ error, cause }), rethrowFrameworkError: browserRethrow },
  );
  return { answers, calls, reports, submitAction };
}

let turnstile: { options: TurnstileRenderOptions[]; resets: string[] };
let randomUUID: ReturnType<typeof mock.method>;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  turnstile = { options: [], resets: [] };
  dom.window.turnstile = {
    render: (_container, options) => {
      turnstile.options.push(options);
      return "widget-1";
    },
    reset: (widgetId) => void turnstile.resets.push(widgetId ?? ""),
    remove: () => {},
  };
  randomUUID = mock.method(globalThis.crypto, "randomUUID", () => TOKEN);
  container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  randomUUID.mock.restore();
});

async function mount(submitAction: ReturnType<typeof harness>["submitAction"]) {
  await act(async () => {
    root.render(createElement(InquiryFormView, { services: [{ slug: "weddings", name: "Weddings" }] as never, submitAction, turnstileSiteKey: "test-site-key" }));
  });
}

const form = () => container.querySelector("form");
const field = (name: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
const sendButton = () => [...container.querySelectorAll("button")].find((b) => /Send/.test(b.textContent ?? ""))!;
const focused = () => dom.window.document.activeElement;

async function solveChallenge(response: string) {
  await act(async () => turnstile.options.at(-1)!.callback(response));
}

function fill() {
  for (const [name, value] of Object.entries(VALUES)) field(name).value = value;
}

function assertValuesKept() {
  for (const [name, value] of Object.entries(VALUES)) assert.equal(field(name).value, value, `${name} was cleared`);
}

async function answer(deferred: Deferred, outcome: { state: InquiryFormState } | { error: unknown }) {
  await act(async () => {
    if ("state" in outcome) deferred.resolve(outcome.state);
    else deferred.reject(outcome.error);
  });
}

describe("mounted inquiry form", () => {
  it("renders every field, the issued token and a ready submit button", async () => {
    const h = harness();
    await mount(h.submitAction);
    assert.ok(form());
    for (const name of [...Object.keys(VALUES), "phone", "serviceSlug"]) assert.ok(field(name), name);
    assert.equal(field(SUBMISSION_TOKEN_FIELD).value, TOKEN);
    assert.equal(randomUUID.mock.callCount(), 1);
    assert.equal(turnstile.options.length, 1, "the challenge is rendered once");
    assert.equal(sendButton().disabled, false);
    assert.equal(container.querySelector("[role=group]"), null, "no summary before a submission");
  });

  it("keeps entered values through a returned validation failure and focuses the error summary", async () => {
    const h = harness();
    await mount(h.submitAction);
    fill();
    await solveChallenge("challenge-1");
    await act(async () => form()!.requestSubmit());
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0]![TURNSTILE_RESPONSE_FIELD], "challenge-1");
    await answer(h.answers[0]!, { state: VALIDATION });

    assertValuesKept();
    const summary = container.querySelector("#inquiry-error-summary");
    assert.ok(summary);
    assert.equal(focused(), summary);
    assert.match(summary.textContent ?? "", /Please check the highlighted fields\./);
    assert.equal(field("email").getAttribute("aria-invalid"), "true");
    assert.equal(field(SUBMISSION_TOKEN_FIELD).value, TOKEN);
    assert.deepEqual(turnstile.resets, ["widget-1"], "the spent challenge is reset");
    assert.equal(field(TURNSTILE_RESPONSE_FIELD).value, "");
    assert.equal(container.querySelector("#inquiry-unconfirmed-summary"), null, "a returned failure is not unconfirmed");
    assert.deepEqual(h.reports, [], "a returned failure is not reported");
  });

  it("drops a second submit while one is in flight, even before React re-renders", async () => {
    const h = harness();
    await mount(h.submitAction);
    fill();
    await act(async () => {
      form()!.requestSubmit();
      form()!.requestSubmit();
    });
    await act(async () => form()!.requestSubmit());
    assert.equal(h.calls.length, 1);
    assert.equal(sendButton().disabled, true);
    assert.equal(sendButton().textContent, "Sending…");

    // Settled, the guard is released for the visitor's next attempt. (An
    // unsettled action would also hold later tests: React entangles every
    // pending async transition.)
    await answer(h.answers[0]!, { state: VALIDATION });
    assert.equal(sendButton().disabled, false);
    assert.equal(sendButton().textContent, "Send inquiry");
    await act(async () => form()!.requestSubmit());
    assert.equal(h.calls.length, 2);
    await answer(h.answers[1]!, { state: VALIDATION });
  });

  it("recovers an unconfirmed submission, then retries manually with the same token and succeeds", async () => {
    const h = harness();
    await mount(h.submitAction);
    fill();
    await solveChallenge("challenge-1");
    await act(async () => form()!.requestSubmit());
    await answer(h.answers[0]!, { error: new TypeError("Failed to fetch") });

    // Recoverable and indeterminate: values, token and form all kept.
    assertValuesKept();
    assert.equal(field(SUBMISSION_TOKEN_FIELD).value, TOKEN);
    const summary = container.querySelector("#inquiry-unconfirmed-summary");
    assert.ok(summary);
    assert.equal(focused(), summary);
    assert.match(summary.textContent ?? "", new RegExp(UNCONFIRMED_HEADING));
    assert.doesNotMatch(summary.textContent ?? "", /Failed to fetch/, "no technical detail reaches the visitor");
    assert.equal(container.querySelector("#inquiry-outdated-summary"), null, "an indeterminate failure is not an outdated action");
    assert.equal(sendButton().disabled, false);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0]!.cause, "indeterminate");
    assert.deepEqual(turnstile.resets, ["widget-1"]);

    // Nothing retries on its own.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    assert.equal(h.calls.length, 1);
    assert.equal(randomUUID.mock.callCount(), 1, "no new token was issued");

    // The guard is released, so the visitor's deliberate retry goes through.
    const retry = [...summary.querySelectorAll("button")].find((b) => b.textContent === UNCONFIRMED_RETRY_LABEL)!;
    assert.equal(retry.disabled, false);
    await solveChallenge("challenge-2");
    await act(async () => retry.click());
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1]![SUBMISSION_TOKEN_FIELD], TOKEN, "the replay lookup needs the original token");
    assert.equal(h.calls[1]![SUBMISSION_TOKEN_FIELD], h.calls[0]![SUBMISSION_TOKEN_FIELD]);
    for (const [name, value] of Object.entries(VALUES)) assert.equal(h.calls[1]![name], value);
    assert.equal(h.calls[1]![TURNSTILE_RESPONSE_FIELD], "challenge-2");

    await answer(h.answers[1]!, { state: SUCCESS });
    assert.equal(form(), null, "the confirmation replaces the form");
    const heading = container.querySelector("h2");
    assert.equal(heading?.textContent, "Inquiry received");
    assert.equal(focused(), heading);
    assert.match(container.textContent ?? "", /Your inquiry has been received\./);
    assert.equal(h.calls.length, 2);
    assert.equal(h.reports.length, 1);
  });
});

describe("mounted inquiry form after a deployment", () => {
  const SECRETS = [TOKEN, "challenge-1", "honeypot-value"];
  let clipboard: { writes: string[]; fail: boolean } | null;

  beforeEach(() => {
    clipboard = { writes: [], fail: false };
    const state = clipboard;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      get: () => (clipboard ? { writeText: async (text: string) => {
        if (state.fail) throw new Error("NotAllowedError");
        state.writes.push(text);
      } } : undefined),
    });
  });

  afterEach(() => {
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  });

  /** Submits once and answers as Next.js does for an action the server no longer knows. */
  async function submitToOutdatedAction() {
    const h = harness();
    await mount(h.submitAction);
    fill();
    (field("serviceSlug") as unknown as HTMLSelectElement).value = "weddings";
    field("website").value = "honeypot-value";
    await solveChallenge("challenge-1");
    await act(async () => form()!.requestSubmit());
    await answer(h.answers[0]!, { error: new UnrecognizedActionError('Server Action "abc" was not found on the server.') });
    const summary = container.querySelector<HTMLElement>("#inquiry-outdated-summary");
    assert.ok(summary);
    const copyButton = [...summary.querySelectorAll("button")].find((b) => b.textContent === OUTDATED_COPY_LABEL)!;
    const status = summary.querySelector("[role=status]")!;
    return { copyButton, h, status, summary };
  }

  it("says plainly that nothing was sent, focuses that summary, and offers no resend", async () => {
    const { h, summary } = await submitToOutdatedAction();
    assert.equal(focused(), summary);
    assert.equal(summary.querySelector("h3")?.textContent, OUTDATED_HEADING);
    assert.match(summary.textContent ?? "", new RegExp(OUTDATED_MESSAGE.replace(/[.?]/g, "\\$&")));
    assert.match(summary.className, /scroll-mt-/, "keeps the sticky-header offset");
    const text = container.textContent ?? "";
    assert.doesNotMatch(text, new RegExp(UNCONFIRMED_HEADING), "nothing implies the inquiry may be saved");
    assert.doesNotMatch(text, /may have been received/);
    assert.equal([...container.querySelectorAll("button")].some((b) => b.textContent === UNCONFIRMED_RETRY_LABEL), false);
    assert.equal(sendButton().disabled, true, "a resend from this page would fail the same way");
    assert.deepEqual(h.reports.map((r) => r.cause), ["unrecognized-action"]);

    // Values stay until the visitor refreshes, and nothing resends on its own.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    assertValuesKept();
    assert.equal(h.calls.length, 1);
  });

  it("copies readable labels and entered values, never hidden fields, without submitting", async () => {
    const { copyButton, h, status } = await submitToOutdatedAction();
    let submits = 0;
    form()!.addEventListener("submit", () => submits++);
    assert.equal(copyButton.getAttribute("type"), "button");
    assert.equal(copyButton.disabled, false, "a native, enabled button is reachable by keyboard");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.textContent, "", "the live region exists before it changes");

    await act(async () => copyButton.click());
    assert.equal(submits, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(clipboard!.writes.length, 1);
    const copied = clipboard!.writes[0]!;
    assert.match(copied, /^Name: Test Visitor$/m);
    assert.match(copied, /^Email: visitor@example\.test$/m);
    assert.match(copied, /^Service: Weddings$/m, "the option's text, not its value");
    assert.match(copied, /Message:\nA test message that is long enough to pass\.$/);
    for (const secret of SECRETS) assert.ok(!copied.includes(secret), "a hidden field was copied");
    assert.equal(status.textContent, OUTDATED_COPY_SUCCESS);
    assertValuesKept();
  });

  it("tells the visitor to copy by hand when the clipboard is refused or missing", async () => {
    const { copyButton, h, status } = await submitToOutdatedAction();
    clipboard!.fail = true;
    await act(async () => copyButton.click());
    assert.equal(status.textContent, OUTDATED_COPY_FAILURE);

    clipboard = null;
    await act(async () => copyButton.click());
    assert.equal(status.textContent, OUTDATED_COPY_FAILURE);
    assert.equal(h.calls.length, 1);
    assertValuesKept();
  });

  it("after an unconfirmed attempt, keeps that uncertainty instead of saying nothing was sent", async () => {
    const h = harness();
    await mount(h.submitAction);
    fill();
    field("website").value = "honeypot-value";
    await solveChallenge("challenge-1");
    await act(async () => form()!.requestSubmit());
    await answer(h.answers[0]!, { error: new TypeError("Failed to fetch") });
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === UNCONFIRMED_RETRY_LABEL)!;
    await act(async () => retry.click());
    assert.equal(h.calls[1]![SUBMISSION_TOKEN_FIELD], TOKEN);
    await answer(h.answers[1]!, { error: new UnrecognizedActionError('Server Action "abc" was not found on the server.') });

    const summary = container.querySelector<HTMLElement>("#inquiry-outdated-summary");
    assert.ok(summary);
    assert.equal(focused(), summary);
    assert.equal(summary.querySelector("h3")?.textContent, OUTDATED_AFTER_UNCONFIRMED_HEADING);
    assert.equal(summary.querySelector("#inquiry-outdated-message")?.textContent, OUTDATED_AFTER_UNCONFIRMED_MESSAGE);
    const text = container.textContent ?? "";
    assert.doesNotMatch(text, /hasn't been sent/, "the earlier attempt may have been stored");
    assert.doesNotMatch(text, new RegExp(OUTDATED_HEADING));
    assert.equal(container.querySelector("#inquiry-unconfirmed-summary"), null);
    assert.equal([...container.querySelectorAll("button")].some((b) => b.textContent === UNCONFIRMED_RETRY_LABEL), false, "no retry that cannot succeed");
    assert.equal(sendButton().disabled, true);
    assert.deepEqual(h.reports.map((r) => r.cause), ["indeterminate", "unrecognized-action"]);

    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    assert.equal(h.calls.length, 2, "nothing retries on its own");
    assertValuesKept();
    assert.equal(field(SUBMISSION_TOKEN_FIELD).value, TOKEN);
    assert.equal(randomUUID.mock.callCount(), 1);

    const copyButton = [...summary.querySelectorAll("button")].find((b) => b.textContent === OUTDATED_COPY_LABEL)!;
    await act(async () => copyButton.click());
    assert.equal(h.calls.length, 2, "copying never submits");
    const copied = clipboard!.writes[0]!;
    assert.match(copied, /^Name: Test Visitor$/m);
    for (const secret of SECRETS) assert.ok(!copied.includes(secret), "a hidden field was copied");
  });
});
