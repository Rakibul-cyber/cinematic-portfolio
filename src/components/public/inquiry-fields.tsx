import { type MouseEvent, type ReactNode, type Ref, useState } from "react";

import {
  inquiryErrorId,
  inquiryErrorItems,
  inquiryCopyText,
  inquiryFieldId,
  type InquiryFieldConfig,
  OUTDATED_AFTER_UNCONFIRMED_HEADING,
  OUTDATED_AFTER_UNCONFIRMED_MESSAGE,
  OUTDATED_COPY_FAILURE,
  OUTDATED_COPY_LABEL,
  OUTDATED_COPY_SUCCESS,
  OUTDATED_HEADING,
  OUTDATED_MESSAGE,
  UNCONFIRMED_HEADING,
  UNCONFIRMED_MESSAGE,
  UNCONFIRMED_RETRY_LABEL,
} from "@/lib/public/inquiry-form";

/**
 * Presentational pieces of the inquiry form, kept apart from the server action
 * import so they render in tests without a database environment.
 *
 * `border-input` meets 3:1 against the page background; an invalid control
 * switches to a red boundary and is described by its error text, so the state
 * is never conveyed by colour alone.
 */

/**
 * Scroll offset for anything the form focuses programmatically: the summary
 * after a failure, and a control reached from a summary link. The sticky
 * header is `--header-height` tall at every breakpoint; the extra 2rem keeps
 * a control's label (one line plus the gap) clear of it as well.
 */
export const inquiryFocusOffsetClass = "scroll-mt-[calc(var(--header-height)+2rem)]";

export const inquiryControlClass =
  `min-h-12 border border-input bg-background aria-[invalid=true]:border-red-400 ${inquiryFocusOffsetClass}`;

const SUMMARY_MESSAGE_ID = "inquiry-error-summary-message";
const UNCONFIRMED_TITLE_ID = "inquiry-unconfirmed-title";
const UNCONFIRMED_MESSAGE_ID = "inquiry-unconfirmed-message";
const OUTDATED_TITLE_ID = "inquiry-outdated-title";
const OUTDATED_MESSAGE_ID = "inquiry-outdated-message";

function controlProps(name: string, error?: string) {
  return {
    "aria-describedby": error ? inquiryErrorId(name) : undefined,
    "aria-invalid": error ? true : undefined,
    id: inquiryFieldId(name),
    name,
  };
}

/**
 * Label, control, and error kept as siblings: an error inside the `<label>`
 * would become part of the field's accessible name. `content-start` keeps the
 * rows at their own height when a neighbouring column's error makes the grid
 * row taller, instead of stretching this field's control to match.
 */
function FieldShell({ children, error, field }: { children: ReactNode; error?: string; field: InquiryFieldConfig }) {
  return (
    <div className="grid content-start gap-2 text-sm">
      <label htmlFor={inquiryFieldId(field.name)}>
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? <span className="text-sm text-red-300" id={inquiryErrorId(field.name)}>{error}</span> : null}
    </div>
  );
}

export function InquiryInput({ error, field }: { error?: string; field: InquiryFieldConfig }) {
  return (
    <FieldShell error={error} field={field}>
      <input {...controlProps(field.name, error)} autoComplete={field.autoComplete} className={`${inquiryControlClass} px-4`} required={field.required} type={field.type ?? "text"}/>
    </FieldShell>
  );
}

export function InquirySelect({ children, error, field }: { children?: ReactNode; error?: string; field: InquiryFieldConfig }) {
  return (
    <FieldShell error={error} field={field}>
      <select {...controlProps(field.name, error)} className={`${inquiryControlClass} px-4`}>{children}</select>
    </FieldShell>
  );
}

export function InquiryTextarea({ error, field }: { error?: string; field: InquiryFieldConfig }) {
  return (
    <FieldShell error={error} field={field}>
      <textarea {...controlProps(field.name, error)} className={`${inquiryControlClass} min-h-40 p-4`} required={field.required}/>
    </FieldShell>
  );
}

/**
 * Success confirmation, which replaces the form and with it the focused submit
 * button. The form focuses the heading instead, so the confirmation is
 * announced through focus; `tabIndex={-1}` allows that without adding a Tab
 * stop. No `role="status"` live region: one inserted already populated is
 * announced unreliably, and where it is announced it would repeat what focus
 * already says. The heading shares the header offset, so focusing it scrolls
 * only if it is out of view and never under the sticky header.
 */
export function InquiryConfirmation({ message, ref }: { message?: string; ref?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="border border-accent p-8">
      <h2 className={`font-display text-3xl ${inquiryFocusOffsetClass}`} ref={ref} tabIndex={-1}>Inquiry received</h2>
      <p className="mt-3 text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Shown when the submission's outcome is unknown, in place of the failure
 * summary and kept visually distinct from it: nothing the visitor entered is
 * wrong, and the inquiry may already be stored. The form focuses it, so its
 * visible heading (the group's name) and message (its description) are
 * announced once on focus. The retry is an ordinary submit of this same form,
 * so it carries the same values and the same submission token; nothing is
 * resubmitted until the visitor presses it.
 */
export function InquiryUnconfirmedSummary({ disabled, ref }: { disabled: boolean; ref?: Ref<HTMLDivElement> }) {
  return (
    <div aria-describedby={UNCONFIRMED_MESSAGE_ID} aria-labelledby={UNCONFIRMED_TITLE_ID} className={`border border-accent p-4 text-sm ${inquiryFocusOffsetClass}`} id="inquiry-unconfirmed-summary" ref={ref} role="group" tabIndex={-1}>
      <h3 className="font-semibold" id={UNCONFIRMED_TITLE_ID}>{UNCONFIRMED_HEADING}</h3>
      <p className="mt-2 leading-6 text-muted-foreground" id={UNCONFIRMED_MESSAGE_ID}>{UNCONFIRMED_MESSAGE}</p>
      <button className="mt-4 min-h-12 border border-accent px-5 font-semibold transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60" disabled={disabled} type="submit">{UNCONFIRMED_RETRY_LABEL}</button>
    </div>
  );
}

/** What the visitor sees in a field: an option's text, not its value. */
function visibleValue(form: HTMLFormElement, name: string): string | undefined {
  const control = form.elements.namedItem(name);
  // Missing, or a group of same-named controls: neither is an inquiry field.
  if (!control || !("tagName" in control)) return undefined;
  if (control.tagName === "SELECT") {
    const select = control as HTMLSelectElement;
    return select.value ? select.selectedOptions[0]?.text : undefined;
  }
  return (control as HTMLInputElement | HTMLTextAreaElement).value;
}

/**
 * Shown when the server no longer recognizes this form's action, after a
 * deployment. That request never ran, so unlike the unconfirmed summary it
 * offers no resend: every attempt from this page would fail the same way
 * until it is refreshed. The form focuses it, as it does the other summaries.
 *
 * With `priorUnconfirmed`, an earlier attempt went unconfirmed and may have
 * been stored, so the copy says so and asks the visitor to check with the
 * studio before sending again, instead of saying nothing was sent.
 *
 * The visitor's entries stay in the fields until they refresh. "Copy message"
 * puts them on the clipboard as readable text built from the visible fields
 * only (see `inquiryCopyText`), so the hidden token, challenge response and
 * honeypot are never copied. It is a plain button, so it cannot submit, and
 * what it copies is neither logged nor sent. Its outcome is announced in a
 * live region that is rendered before it changes; if the clipboard is
 * unavailable or refused, the visitor is told to copy by hand.
 */
export function InquiryOutdatedSummary({ priorUnconfirmed = false, ref }: { priorUnconfirmed?: boolean; ref?: Ref<HTMLDivElement> }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.form;
    const text = form ? inquiryCopyText((name) => visibleValue(form, name)) : "";
    try {
      if (!text || !navigator.clipboard) throw new Error("Nothing to copy, or no clipboard");
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return (
    <div aria-describedby={OUTDATED_MESSAGE_ID} aria-labelledby={OUTDATED_TITLE_ID} className={`border border-accent p-4 text-sm ${inquiryFocusOffsetClass}`} id="inquiry-outdated-summary" ref={ref} role="group" tabIndex={-1}>
      <h3 className="font-semibold" id={OUTDATED_TITLE_ID}>{priorUnconfirmed ? OUTDATED_AFTER_UNCONFIRMED_HEADING : OUTDATED_HEADING}</h3>
      <p className="mt-2 leading-6 text-muted-foreground" id={OUTDATED_MESSAGE_ID}>{priorUnconfirmed ? OUTDATED_AFTER_UNCONFIRMED_MESSAGE : OUTDATED_MESSAGE}</p>
      <button className="mt-4 min-h-12 border border-accent px-5 font-semibold transition-colors hover:bg-accent hover:text-accent-foreground" onClick={copy} type="button">{OUTDATED_COPY_LABEL}</button>
      <p aria-live="polite" className="mt-2 leading-6" role="status">{copyStatus === "copied" ? OUTDATED_COPY_SUCCESS : copyStatus === "failed" ? OUTDATED_COPY_FAILURE : ""}</p>
    </div>
  );
}

/**
 * Failure summary. The form moves focus here after every failed submission,
 * so it is announced on focus rather than also as a live alert; each field
 * error links to, and focuses, its control.
 *
 * The group's name is a fixed phrase and the visible message is its
 * description, so focus announces the message once instead of reading it both
 * as the name and again as the description or content.
 */
export function InquiryErrorSummary({ errors, message, ref }: { errors?: Record<string, string[] | undefined>; message: string; ref?: Ref<HTMLDivElement> }) {
  const items = inquiryErrorItems(errors);
  return (
    <div aria-describedby={SUMMARY_MESSAGE_ID} aria-label="Inquiry not sent" className={`border border-red-400 p-4 text-sm ${inquiryFocusOffsetClass}`} id="inquiry-error-summary" ref={ref} role="group" tabIndex={-1}>
      <p className="font-semibold" id={SUMMARY_MESSAGE_ID}>{message}</p>
      {items.length ? (
        <ul className="mt-3 grid gap-1">
          {items.map((item) => (
            <li key={item.name}>
              <a
                className="underline underline-offset-4 hover:text-foreground"
                href={`#${item.fieldId}`}
                onClick={(event) => {
                  const control = document.getElementById(item.fieldId);
                  if (!control) return;
                  event.preventDefault();
                  control.focus();
                }}
              >
                {item.label}: {item.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
