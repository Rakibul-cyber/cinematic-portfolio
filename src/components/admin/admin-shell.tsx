import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(admin)/admin/actions";
import type { AdminUser } from "@/server/auth/session";

const links = [
  ["Dashboard", "/admin"],
  ["Projects", "/admin/projects"],
  ["Categories", "/admin/categories"],
  ["Media", "/admin/media"],
  ["Services", "/admin/services"],
  ["Testimonials", "/admin/testimonials"],
  ["Pages", "/admin/pages"],
  ["Settings", "/admin/settings"],
] as const;
export function AdminShell({
  user,
  title,
  children,
}: {
  user: AdminUser;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-border p-5 md:border-r md:border-b-0">
        <p className="font-display text-xl">Studio CMS</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {user.name} · {user.role}
        </p>
        <nav
          aria-label="Admin"
          className="mt-6 grid grid-cols-2 gap-1 md:grid-cols-1"
        >
          {links.map(([label, href]) => (
            <Link
              className="min-h-10 px-3 py-2 text-sm hover:bg-surface-strong"
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction} className="mt-6">
          <button className="text-sm underline">Sign out</button>
        </form>
      </aside>
      <main id="main-content" className="min-w-0 p-5 sm:p-8">
        <h1 className="mb-8 font-display text-4xl">{title}</h1>
        {children}
      </main>
    </div>
  );
}
export function Notice({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mb-5 border border-accent p-3 text-sm">
      {message}
    </p>
  ) : null;
}
export const inputClass =
  "min-h-10 w-full border border-border bg-background px-3";
export const areaClass =
  "min-h-28 w-full border border-border bg-background p-3";
export const buttonClass =
  "min-h-10 border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground";
