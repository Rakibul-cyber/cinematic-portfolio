"use client";

import { useActionState, useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

import type { AdminFormState } from "@/lib/admin/form-state";

type SaveAction = (state: AdminFormState, form: FormData) => Promise<AdminFormState>;

type Marked = { el: HTMLElement; describedBy: string | null };

/**
 * Admin save form that keeps what the editor typed when a save is rejected.
 *
 * React resets a form once its action finishes. After a successful save, which
 * redirects, that is what should happen; after a rejected one it would throw
 * the editor's work away. So the submitted values are captured on submit and
 * written back when the action returns an error. They stay in the browser: the
 * server answers with only a message and a field name.
 *
 * The named field is marked invalid, described by the message and focused; the
 * message itself is a `role="alert"` at the top of this form, so on a page with
 * several forms it appears beside the one that failed.
 */
export function AdminForm({ action, children, ...props }: Omit<ComponentProps<"form">, "action"> & { action: SaveAction }) {
  const [state, formAction] = useActionState(action, null);
  // A redirecting (successful) save leaves the previous state in place, so an
  // error is only shown if it arrived after the latest submit.
  const [dismissed, setDismissed] = useState<AdminFormState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<FormData | null>(null);
  const marked = useRef<Marked | null>(null);
  const errorId = useId();
  const visible = state && state !== dismissed ? state : null;

  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form || !visible) {
      setMessage(null);
      return;
    }
    if (submitted.current) restoreValues(form, submitted.current);
    const field = visible.field ? form.elements.namedItem(visible.field) : null;
    if (field instanceof HTMLElement && !(field instanceof HTMLInputElement && field.type === "hidden")) {
      marked.current = { el: field, describedBy: field.getAttribute("aria-describedby") };
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", [marked.current.describedBy, errorId].filter(Boolean).join(" "));
      const label = labelText(field);
      setMessage(label ? `${label}: ${visible.error}` : visible.error);
      field.focus();
    } else {
      setMessage(visible.error);
    }
  }, [visible, errorId]);

  return (
    <form
      {...props}
      action={formAction}
      onSubmit={(event) => {
        submitted.current = new FormData(event.currentTarget);
        unmark(marked);
        setDismissed(state);
      }}
      ref={formRef}
    >
      {message ? (
        <p className="col-span-full border border-accent p-3 text-sm" id={errorId} role="alert">
          {message}
        </p>
      ) : null}
      {children}
    </form>
  );
}

function unmark(marked: { current: Marked | null }) {
  const current = marked.current;
  if (!current) return;
  current.el.removeAttribute("aria-invalid");
  if (current.describedBy) current.el.setAttribute("aria-describedby", current.describedBy);
  else current.el.removeAttribute("aria-describedby");
  marked.current = null;
}

/** Writes submitted values back over React's post-action form reset. Hidden, file and password fields are left alone. */
function restoreValues(form: HTMLFormElement, data: FormData) {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) {
      if (!el.name || ["hidden", "file", "password", "submit", "button"].includes(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio") el.checked = data.getAll(el.name).includes(el.value);
      else el.value = String(data.get(el.name) ?? "");
    } else if ((el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.name) {
      el.value = String(data.get(el.name) ?? "");
    }
  }
}

/** The visible text of a field's label, without the text of the control it wraps. */
function labelText(el: HTMLElement): string | null {
  const label = (el as HTMLInputElement).labels?.[0];
  if (!label) return null;
  const text = Array.from(label.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
