/**
 * Inquiry form wiring that needs no React, so it is testable in isolation.
 *
 * Field names here must match `inquirySchema`; they are the keys the server
 * action reports errors under.
 */

// Type-only: erased at runtime, so this module never loads the server action.
import type { InquiryFormState } from "@/app/(public)/contact/actions";

export type InquiryFieldConfig = {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
};

/** The text inputs, in display order. */
export const INQUIRY_INPUT_FIELDS: readonly InquiryFieldConfig[] = [
  { name: "name", label: "Name", required: true, autoComplete: "name" },
  { name: "email", label: "Email", required: true, type: "email", autoComplete: "email" },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { name: "whatsapp", label: "WhatsApp", type: "tel", autoComplete: "tel" },
  { name: "company", label: "Company", autoComplete: "organization" },
  { name: "projectType", label: "Project type", required: true },
  { name: "projectDate", label: "Preferred date", type: "date" },
  { name: "location", label: "Location" },
  { name: "budgetLabel", label: "Budget" },
  { name: "referralSource", label: "How did you hear about us?" },
];

export const INQUIRY_SERVICE_FIELD: InquiryFieldConfig = { name: "serviceSlug", label: "Service" };
export const INQUIRY_MESSAGE_FIELD: InquiryFieldConfig = { name: "message", label: "Message", required: true };

/** Every visible field, in the order the error summary lists them. */
export const INQUIRY_FIELDS: readonly InquiryFieldConfig[] = [
  ...INQUIRY_INPUT_FIELDS,
  INQUIRY_SERVICE_FIELD,
  INQUIRY_MESSAGE_FIELD,
];

export const inquiryFieldId = (name: string) => `inquiry-${name}`;
export const inquiryErrorId = (name: string) => `inquiry-${name}-error`;

export type InquiryErrorItem = { name: string; label: string; message: string; fieldId: string };

/**
 * Field errors for the summary, in display order. Keys for fields the visitor
 * cannot see (the hidden token and honeypot) are left out: there is nothing
 * for them to correct, and the summary message still covers the failure.
 */
export function inquiryErrorItems(errors?: Record<string, string[] | undefined>): InquiryErrorItem[] {
  if (!errors) return [];
  return INQUIRY_FIELDS.flatMap((field) => {
    const message = errors[field.name]?.[0];
    return message ? [{ name: field.name, label: field.label, message, fieldId: inquiryFieldId(field.name) }] : [];
  });
}

type SubmitEventLike = { preventDefault(): void; currentTarget: HTMLFormElement };

/**
 * Submits the form without React's automatic form reset.
 *
 * When a `<form>`'s `action` is a function, React 19 queues a reset of every
 * uncontrolled field before running it, whatever the action returns. The
 * inquiry action reports failures as returned state, so a typo, a failed
 * challenge, or a server error would each wipe the visitor's message.
 * Preventing the native submit and dispatching in a transition ourselves is
 * React's supported opt-out: it still drives `pending`, but never resets.
 *
 * Success needs no reset, because the form is replaced by a confirmation.
 * A second submit while one is in flight is dropped.
 */
export function createInquirySubmitHandler({
  dispatch,
  inFlight,
  readForm = (form) => new FormData(form),
  startTransition,
}: {
  dispatch: (formData: FormData) => void;
  inFlight: { current: boolean };
  readForm?: (form: HTMLFormElement) => FormData;
  startTransition: (callback: () => void) => void;
}) {
  return (event: SubmitEventLike) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const formData = readForm(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}

/** Approved copy for a submission whose outcome the browser never learned. */
export const UNCONFIRMED_HEADING = "We couldn't confirm your inquiry";
export const UNCONFIRMED_MESSAGE =
  "Your message may have been received, but we couldn't confirm it. Your details are still here. Please check your connection and try sending again.";
export const UNCONFIRMED_RETRY_LABEL = "Try sending again";

/** Approved copy for an action the server no longer recognizes. */
export const OUTDATED_HEADING = "The website has been updated";
export const OUTDATED_MESSAGE =
  "Your message hasn't been sent. Please copy your message before refreshing this page, then try again.";
/**
 * Copy for an outdated action after an earlier attempt went unconfirmed: the
 * outdated answer only proves the later request never ran, while the earlier
 * one may have been stored.
 */
export const OUTDATED_AFTER_UNCONFIRMED_HEADING = "We couldn't confirm your earlier inquiry";
export const OUTDATED_AFTER_UNCONFIRMED_MESSAGE =
  "Your earlier message may have been received, but the website has since been updated. Please copy your message before refreshing. If you're unsure whether it arrived, contact us before sending it again.";
export const OUTDATED_COPY_LABEL = "Copy message";
export const OUTDATED_COPY_SUCCESS = "Your message has been copied.";
export const OUTDATED_COPY_FAILURE =
  "Your message couldn't be copied automatically. Please select and copy it from the fields below.";

/**
 * The action's state, plus client-only markers: `unconfirmed` when the
 * outcome is unknown, `outdated` when the server said it no longer knows
 * this action, so that request never ran and resending from this page cannot
 * work, and `priorUnconfirmed` once any earlier attempt with this token went
 * unconfirmed, so it may have been stored whatever later attempts report.
 */
export type ClientInquiryState = InquiryFormState & { unconfirmed?: boolean; outdated?: boolean; priorUnconfirmed?: boolean };

/**
 * Why a submission was left unconfirmed, as far as the browser can tell.
 *
 * `unrecognized-action`: the server answered that it no longer knows this
 * action, which happens after a deployment. It never ran, so nothing was
 * stored, and every resend from this page would meet the same answer: the
 * visitor is told so and asked to keep their message and refresh.
 *
 * `indeterminate`: every other rejection. A dropped connection rejects with
 * a `TypeError`, an error response or an unreadable reply with a plain
 * `Error`, a platform timeout with either, and a defect in framework code
 * with whatever it throws. Next.js offers no public way to tell these apart
 * (the code it tags error responses with is internal), and a `TypeError` is
 * also what a bug throws, so none of them is classified further. Each may
 * have happened after the server stored the inquiry.
 */
export type UnconfirmedCause = "unrecognized-action" | "indeterminate";

/**
 * Turns a thrown server action into an "unconfirmed" or "outdated" state
 * instead of a render error, and reports why.
 *
 * The action returns every failure it can observe, its own unexpected errors
 * included, so a throw reaching the browser came from around the action: the
 * request, the response, or the framework code carrying them. Only the action
 * call is inside the `try`, so a defect in this form's own code is never
 * caught here. None of those failures says whether the inquiry was stored,
 * because the server commits it before it awaits email delivery. Left to
 * throw, the route error boundary would replace the form, losing what the
 * visitor typed, and its remount would issue a new submission token, so a
 * retry of a stored inquiry would create a second one. Resolved instead, the
 * form stays mounted with its values and the same token, and a deliberate
 * retry is answered by the server's replay lookup if the first attempt was
 * stored.
 *
 * Recovery is not silence: every recovered error goes to `report`, so a
 * defect that surfaces this way is still seen. Framework control flow
 * (redirect, not-found and similar) is handed to `rethrowFrameworkError`
 * first, which must throw it, so routing behaves as before. The action is
 * called exactly once per dispatch; nothing retries automatically.
 *
 * Once an attempt is unconfirmed, every later state for the same token
 * carries `priorUnconfirmed`. A later answer cannot clear it: a later
 * failure only shows the inquiry was not stored when that attempt checked,
 * while the earlier request may still have been running, and an outdated
 * action only shows the later request never ran. The outdated state then
 * says the earlier message may have been received instead of saying nothing
 * was sent.
 */
export function withUnconfirmedRecovery(
  action: (previous: InquiryFormState, form: FormData) => Promise<InquiryFormState>,
  {
    isUnrecognizedAction,
    report,
    rethrowFrameworkError,
  }: {
    isUnrecognizedAction: (error: unknown) => boolean;
    report: (error: unknown, cause: UnconfirmedCause) => void;
    rethrowFrameworkError: (error: unknown) => void;
  },
) {
  return async (previous: ClientInquiryState, form: FormData): Promise<ClientInquiryState> => {
    const priorUnconfirmed = Boolean(previous.unconfirmed || previous.priorUnconfirmed);
    const history = priorUnconfirmed ? { priorUnconfirmed } : {};
    try {
      const state = await action(previous, form);
      return priorUnconfirmed ? { ...state, ...history } : state;
    } catch (error) {
      rethrowFrameworkError(error);
      const cause: UnconfirmedCause = isUnrecognizedAction(error) ? "unrecognized-action" : "indeterminate";
      try {
        report(error, cause);
      } catch (reportFailure) {
        // A broken reporter must neither cost the visitor their form nor go
        // unseen: it is rethrown on its own, outside this submission.
        queueMicrotask(() => {
          throw reportFailure;
        });
      }
      if (cause === "indeterminate") return { success: false, unconfirmed: true, message: UNCONFIRMED_MESSAGE, ...history };
      return priorUnconfirmed
        ? { success: false, outdated: true, message: OUTDATED_AFTER_UNCONFIRMED_MESSAGE, ...history }
        : { success: false, outdated: true, message: OUTDATED_MESSAGE };
    }
  };
}

export type InquiryOutcome = "idle" | "failure" | "unconfirmed" | "outdated" | "success";

/**
 * Called once per answered submission. Releases the in-flight guard whatever
 * the outcome, so a failed or unconfirmed attempt can be retried, and reports
 * what the visitor must be shown: after a failure, an unconfirmed attempt or
 * an outdated action the form resets the Turnstile challenge and focuses the
 * summary; after a success it focuses the confirmation that replaced the form.
 *
 * Only framework control flow still rejects (see `withUnconfirmedRecovery`),
 * and that is handled by Next.js rather than by this form.
 */
export function settleInquirySubmission(
  state: ClientInquiryState,
  inFlight: { current: boolean },
): InquiryOutcome {
  inFlight.current = false;
  if (state.success) return "success";
  if (state.unconfirmed) return "unconfirmed";
  if (state.outdated) return "outdated";
  return state.message ? "failure" : "idle";
}

type FocusTarget = { focus(options?: FocusOptions): void; scrollIntoView(options?: ScrollIntoViewOptions): void };

/**
 * Moves focus to an answer the form shows (a summary or the confirmation) and
 * places it just below the sticky header.
 *
 * A plain `focus()` is not enough on this smooth-scrolling site. Focusing a
 * field starts a smooth scroll towards it; if the action answers before that
 * animation ends, the target is focused while it still looks visible, so
 * focus asks for no scroll of its own, and the earlier animation carries on
 * and leaves the focused target off-screen. When focus does scroll, Chromium
 * centres the target rather than honouring its header offset. An explicit
 * `scrollIntoView` replaces any animation in progress and aligns the target's
 * top to its `scroll-margin-top`. Its default behaviour follows the
 * stylesheet, so it is smooth normally and instant under reduced motion.
 */
export function focusAnswer(target: FocusTarget | null): void {
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
}

/**
 * The visitor's entries as readable text, for copying before a refresh.
 *
 * Built from the visible fields only, by allowlist, so the submission token,
 * the Turnstile response and the honeypot can never be included. `read`
 * returns what the visitor sees for a field (an option's text, not its
 * value); empty fields are left out. The message comes last, on lines of its
 * own, so it stays readable whatever its length.
 */
export function inquiryCopyText(read: (name: string) => string | undefined): string {
  const lines = INQUIRY_FIELDS.flatMap((field) => {
    const value = read(field.name)?.trim();
    if (!value) return [];
    return field.name === INQUIRY_MESSAGE_FIELD.name ? [`${field.label}:`, value] : [`${field.label}: ${value}`];
  });
  return lines.join("\n");
}
