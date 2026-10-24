import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { InquiryConfirmation, InquiryErrorSummary, InquiryInput, InquiryOutdatedSummary, InquirySelect, InquiryTextarea, InquiryUnconfirmedSummary } from "@/components/public/inquiry-fields";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { type ClientInquiryState, createInquirySubmitHandler, INQUIRY_INPUT_FIELDS, INQUIRY_MESSAGE_FIELD, INQUIRY_SERVICE_FIELD, settleInquirySubmission } from "@/lib/public/inquiry-form";
import { SUBMISSION_TOKEN_FIELD, useSubmissionToken } from "@/lib/security/submission-token";
import type { PublicService } from "@/server/public/view-models";

const initial: ClientInquiryState = { success: false };
export type InquirySubmitAction = (previous: ClientInquiryState, form: FormData) => Promise<ClientInquiryState>;

/**
 * The inquiry form, given the action it submits to. `InquiryForm` binds it to
 * the real server action; tests mount it with a stand-in, so it never loads
 * the server action module or its database client.
 *
 * `submitAction` must be referentially stable for `useActionState`.
 */
export function InquiryFormView({ services, submitAction, turnstileSiteKey }: { services: PublicService[]; submitAction: InquirySubmitAction; turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState(submitAction, initial);
  // Issued in the browser after hydration, never during rendering: this route
  // is statically prerendered, so a render-time token would be cached and
  // shared. Empty until then, which gates the submit button below.
  const submissionToken = useSubmissionToken();
  // A rejected submission spends its Turnstile response, so the widget is told
  // to issue a fresh challenge. The counter is the signal; the widget owns the
  // reset, because only it holds the widget id.
  const [resetSignal, setResetSignal] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  // Set on submit, cleared when the action answers; `pending` alone arrives a
  // render late for a rapid second Enter.
  const inFlight = useRef(false);
  // Entered values survive a failed attempt because this handler opts out of
  // React's automatic form reset; see `createInquirySubmitHandler`.
  const onSubmit = createInquirySubmitHandler({ dispatch: action, inFlight, startTransition });
  useEffect(() => {
    const outcome = settleInquirySubmission(state, inFlight);
    if (outcome === "failure" || outcome === "unconfirmed" || outcome === "outdated") {
      setResetSignal((count) => count + 1);
      summaryRef.current?.focus();
    } else if (outcome === "success") {
      confirmationRef.current?.focus();
    }
  }, [state]);
  if (state.success) return <InquiryConfirmation message={state.message} ref={confirmationRef}/>;
  const error = (name: string) => state.errors?.[name]?.[0];
  return <form action={action} className="grid gap-6" noValidate onSubmit={onSubmit}>
    <input name={SUBMISSION_TOKEN_FIELD} type="hidden" value={submissionToken}/><div aria-hidden="true" className="absolute -left-[10000px]"><label>Website<input autoComplete="off" name="website" tabIndex={-1}/></label></div>
    {state.unconfirmed ? <InquiryUnconfirmedSummary disabled={pending || !submissionToken} ref={summaryRef}/> : state.outdated ? <InquiryOutdatedSummary priorUnconfirmed={state.priorUnconfirmed} ref={summaryRef}/> : state.message ? <InquiryErrorSummary errors={state.errors} message={state.message} ref={summaryRef}/> : null}
    <div className="grid gap-6 sm:grid-cols-2">{INQUIRY_INPUT_FIELDS.map((field) => <InquiryInput error={error(field.name)} field={field} key={field.name}/>)}</div>
    <InquirySelect error={error(INQUIRY_SERVICE_FIELD.name)} field={INQUIRY_SERVICE_FIELD}><option value="">Not sure yet</option>{services.map((s)=><option key={s.slug} value={s.slug}>{s.name}</option>)}</InquirySelect>
    <InquiryTextarea error={error(INQUIRY_MESSAGE_FIELD.name)} field={INQUIRY_MESSAGE_FIELD}/>
    {turnstileSiteKey ? <TurnstileWidget resetSignal={resetSignal} siteKey={turnstileSiteKey}/> : null}
    <p className="text-xs leading-5 text-muted-foreground">We use your details to handle your inquiry. See our <a className="underline underline-offset-4 hover:text-foreground" href="/privacy">privacy notice</a>.</p>
    {/* After an outdated action no send from this page can succeed, so none is offered until it is refreshed. */}
    <button className="min-h-12 bg-accent px-6 font-semibold text-accent-foreground disabled:opacity-60" disabled={pending || !submissionToken || state.outdated}>{pending ? "Sending…" : "Send inquiry"}</button>
  </form>;
}
