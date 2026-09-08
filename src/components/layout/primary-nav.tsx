"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigation } from "@/content/site";
import { cn } from "@/lib/utils";

/** True for the section's own page and anything nested under it. */
export function isCurrentSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop primary navigation.
 *
 * A Client Component only because the current section is derived from the
 * pathname; the rest of the header stays a Server Component. The current page
 * is marked with `aria-current` and a restrained colour change rather than a
 * decorative indicator.
 */
export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="hidden md:block">
      <ul className="flex items-center gap-7 lg:gap-10">
        {navigation.map((item) => {
          const isCurrent = isCurrentSection(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] uppercase transition-colors hover:text-foreground",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
                href={item.href}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
