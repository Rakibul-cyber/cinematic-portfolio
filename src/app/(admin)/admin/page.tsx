import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/app/(admin)/admin/actions";
import { ADMIN_ROOT_PATH } from "@/lib/admin-routes";
import { roleLabels } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";

/**
 * Minimal admin shell for Phase 2.
 *
 * Its only job is to prove the foundation works end to end: the route is
 * protected on the server, the current user and role can be read, and sign-out
 * revokes access. CMS features arrive in later phases.
 */

// The page reads the session on every request; it must never be cached.
export const dynamic = "force-dynamic";

const plannedSections = [
  { label: "Dashboard", phase: "Phase 4" },
  { label: "Projects", phase: "Phase 4" },
  { label: "Media library", phase: "Phase 3" },
  { label: "Services & testimonials", phase: "Phase 4" },
  { label: "Inquiries & CRM", phase: "Phase 6" },
  { label: "Settings & SEO", phase: "Phase 4" },
];

export default async function AdminHomePage() {
  const user = await requireUser(ADMIN_ROOT_PATH);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Studio administration
          </p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">
            Signed in as {user.name}
          </h1>
        </div>

        <form action={signOutAction}>
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-200 hover:border-foreground hover:bg-foreground hover:text-background"
            type="submit"
          >
            <LogOut aria-hidden="true" className="size-4" strokeWidth={1.5} />
            Sign out
          </button>
        </form>
      </header>

      <section aria-labelledby="session-heading" className="flex flex-col gap-4">
        <h2
          className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
          id="session-heading"
        >
          Current session
        </h2>

        <dl className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
          <div className="bg-surface p-5">
            <dt className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
              Name
            </dt>
            <dd className="mt-2 text-sm break-words">{user.name}</dd>
          </div>
          <div className="bg-surface p-5">
            <dt className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
              Email
            </dt>
            <dd className="mt-2 text-sm break-words">{user.email}</dd>
          </div>
          <div className="bg-surface p-5">
            <dt className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
              Role
            </dt>
            <dd className="mt-2 inline-flex items-center gap-2 text-sm">
              <ShieldCheck aria-hidden="true" className="size-4 text-accent" strokeWidth={1.5} />
              {roleLabels[user.role]}
            </dd>
          </div>
        </dl>

        <p className="text-sm leading-relaxed text-muted-foreground">
          This role was read from the database on the server for this request. It
          is never taken from the browser, and hiding an interface element is
          never treated as an authorization control.
        </p>
      </section>

      <section
        aria-labelledby="upcoming-heading"
        className="flex flex-col gap-4 border border-border bg-surface p-6"
      >
        <h2
          className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
          id="upcoming-heading"
        >
          Content management arrives in later phases
        </h2>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Phase 2 delivers the database, authentication, role, and audit
          foundation only. The sections below are a preview of the planned
          navigation and are not implemented yet.
        </p>

        <ul className="grid gap-2 sm:grid-cols-2">
          {plannedSections.map((section) => (
            <li
              className="flex items-center justify-between gap-3 border border-border/70 px-4 py-3 text-sm text-muted-foreground"
              key={section.label}
            >
              <span>{section.label}</span>
              <span className="text-[0.65rem] font-semibold tracking-[0.12em] uppercase">
                {section.phase}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <Link className="inline-flex min-h-12 items-center justify-center bg-accent px-5 text-sm font-semibold text-accent-foreground" href="/admin/media">Open media library</Link>
    </div>
  );
}
