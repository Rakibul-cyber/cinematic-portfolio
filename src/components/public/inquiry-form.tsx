"use client";
import { useActionState, useState } from "react";
import { submitInquiry, type InquiryFormState } from "@/app/(public)/contact/actions";
import type { PublicService } from "@/server/public/view-models";

const initial: InquiryFormState = { success: false };
function Field({ label, name, required, type = "text", error }: { label: string; name: string; required?: boolean; type?: string; error?: string }) {
  return <label className="grid gap-2 text-sm">{label}{required ? " *" : ""}<input aria-describedby={error ? `${name}-error` : undefined} aria-invalid={Boolean(error)} className="min-h-12 border border-border bg-background px-4" name={name} required={required} type={type}/>{error ? <span className="text-sm text-red-300" id={`${name}-error`}>{error}</span> : null}</label>;
}
export function InquiryForm({ services }: { services: PublicService[] }) {
  const [state, action, pending] = useActionState(submitInquiry, initial);
  const [token] = useState(() => crypto.randomUUID());
  if (state.success) return <div className="border border-accent p-8" role="status"><h2 className="font-display text-3xl">Inquiry received</h2><p className="mt-3 text-muted-foreground">{state.message}</p></div>;
  const error = (name: string) => state.errors?.[name]?.[0];
  return <form action={action} className="grid gap-6" noValidate>
    <input name="submissionToken" type="hidden" value={token}/><div aria-hidden="true" className="absolute -left-[10000px]"><label>Website<input autoComplete="off" name="website" tabIndex={-1}/></label></div>
    {state.message ? <p className="border border-red-400 p-3 text-sm" role="alert">{state.message}</p> : null}
    <div className="grid gap-6 sm:grid-cols-2"><Field label="Name" name="name" required error={error("name")}/><Field label="Email" name="email" required type="email" error={error("email")}/><Field label="Phone" name="phone" error={error("phone")}/><Field label="WhatsApp" name="whatsapp" error={error("whatsapp")}/><Field label="Company" name="company" error={error("company")}/><Field label="Project type" name="projectType" required error={error("projectType")}/><Field label="Preferred date" name="projectDate" type="date" error={error("projectDate")}/><Field label="Location" name="location" error={error("location")}/><Field label="Budget" name="budgetLabel" error={error("budgetLabel")}/><Field label="How did you hear about us?" name="referralSource" error={error("referralSource")}/></div>
    <label className="grid gap-2 text-sm">Service<select className="min-h-12 border border-border bg-background px-4" name="serviceSlug"><option value="">Not sure yet</option>{services.map((s)=><option key={s.slug} value={s.slug}>{s.name}</option>)}</select>{error("serviceSlug") ? <span className="text-red-300">{error("serviceSlug")}</span> : null}</label>
    <label className="grid gap-2 text-sm">Message *<textarea aria-invalid={Boolean(error("message"))} className="min-h-40 border border-border bg-background p-4" name="message" required/>{error("message") ? <span className="text-red-300">{error("message")}</span> : null}</label>
    <button className="min-h-12 bg-accent px-6 font-semibold text-accent-foreground disabled:opacity-60" disabled={pending}>{pending ? "Sending…" : "Send inquiry"}</button>
  </form>;
}
