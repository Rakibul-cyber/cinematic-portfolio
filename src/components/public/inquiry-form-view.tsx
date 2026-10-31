import { type ReactNode, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { InquiryChoiceChips, InquiryConfirmation, InquiryErrorSummary, InquiryInput, InquiryOutdatedSummary, InquirySelect, InquiryTextarea, InquiryUnconfirmedSummary } from "@/components/public/inquiry-fields";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { type ClientInquiryState, createInquirySubmitHandler, focusAnswer, INQUIRY_INPUT_FIELDS, INQUIRY_MESSAGE_FIELD, INQUIRY_SERVICE_FIELD, settleInquirySubmission } from "@/lib/public/inquiry-form";
import { SUBMISSION_TOKEN_FIELD, useSubmissionToken } from "@/lib/security/submission-token";
import type { PublicService } from "@/server/public/view-models";

const initial: ClientInquiryState = { success: false };
export type InquirySubmitAction = (previous: ClientInquiryState, form: FormData) => Promise<ClientInquiryState>;

const PROJECT_TYPE_OPTIONS = ["Photography", "Film & video", "Event coverage", "Commercial shoot", "Creative collaboration", "Not sure yet"] as const;
/** Fields tucked into the collapsed optional details; they open if one has an error. */
const OPTIONAL_DETAIL_FIELDS = ["whatsapp", "company", "location", "budgetLabel", "referralSource"] as const;

function fieldConfig(name: string, label?: string) {
  const field = INQUIRY_INPUT_FIELDS.find((candidate) => candidate.name === name)!;
  return label ? { ...field, label } : field;
}

function FormAct({ children, index, title }: { children: ReactNode; index: string; title: string }) {
  return (
    <fieldset className="mv-act">
      <legend className="mv-act-title"><span aria-hidden="true" className="mv-numeral">{index}</span>{title}</legend>
      {children}
    </fieldset>
  );
}

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
  const detailsRef = useRef<HTMLDetailsElement>(null);
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
      // An error inside the collapsed details must not stay hidden.
      if (detailsRef.current && [...OPTIONAL_DETAIL_FIELDS, INQUIRY_SERVICE_FIELD.name].some((name) => state.errors?.[name]?.[0])) detailsRef.current.open = true;
      focusAnswer(summaryRef.current);
    } else if (outcome === "success") {
      focusAnswer(confirmationRef.current);
    }
  }, [state]);
  if (state.success) return <InquiryConfirmation message={state.message} ref={confirmationRef}/>;
  const error = (name: string) => state.errors?.[name]?.[0];
  const input = (name: string, label?: string, hint?: string) => <InquiryInput error={error(name)} field={fieldConfig(name, label)} hint={hint} key={name}/>;
  return <form action={action} className="mv-form" noValidate onSubmit={onSubmit}>
    <input name={SUBMISSION_TOKEN_FIELD} type="hidden" value={submissionToken}/><div aria-hidden="true" className="absolute -left-[10000px]"><label>Website<input autoComplete="off" name="website" tabIndex={-1}/></label></div>
    {state.unconfirmed ? <InquiryUnconfirmedSummary disabled={pending || !submissionToken} ref={summaryRef}/> : state.outdated ? <InquiryOutdatedSummary priorUnconfirmed={state.priorUnconfirmed} ref={summaryRef}/> : state.message ? <InquiryErrorSummary errors={state.errors} message={state.message} ref={summaryRef}/> : null}
    <FormAct index="01" title="About you">
      <div className="mv-fields">{input("name", "Full name")}{input("email", "Email address")}{input("phone", "Phone (optional)")}</div>
    </FormAct>
    <FormAct index="02" title="The project">
      <InquiryChoiceChips error={error("projectType")} field={fieldConfig("projectType", "Service or project type")} options={PROJECT_TYPE_OPTIONS}/>
      <div className="mv-fields">{input("projectDate", "Event or project date (optional)", "Flexible or undecided? Leave it blank.")}</div>
    </FormAct>
    <FormAct index="03" title="Your story">
      <InquiryTextarea error={error(INQUIRY_MESSAGE_FIELD.name)} field={{ ...INQUIRY_MESSAGE_FIELD, label: "Message / project description" }} hint="The more you share about your idea, the better we can shape it."/>
    </FormAct>
    <details className="mv-details" ref={detailsRef}>
      <summary>Add optional details</summary>
      <div className="mv-fields">
        {input("whatsapp")}{input("company")}{input("location")}{input("budgetLabel")}{input("referralSource")}
        <InquirySelect error={error(INQUIRY_SERVICE_FIELD.name)} field={INQUIRY_SERVICE_FIELD}><option value="">Not sure yet</option>{services.map((s)=><option key={s.slug} value={s.slug}>{s.name}</option>)}</InquirySelect>
      </div>
    </details>
    {turnstileSiteKey ? <TurnstileWidget resetSignal={resetSignal} siteKey={turnstileSiteKey}/> : null}
    <p className="text-xs leading-5 text-muted-foreground">We use your details to handle your inquiry. See our <a className="underline underline-offset-4 hover:text-foreground" href="/privacy">privacy notice</a>.</p>
    {/* After an outdated action no send from this page can succeed, so none is offered until it is refreshed. */}
    <div className="mv-submit-row"><button className="mv-submit" disabled={pending || !submissionToken || state.outdated}>{pending ? "Sending…" : "Submit inquiry"}</button><span aria-hidden="true" className="mv-hint">* Required</span></div>
  </form>;
}
