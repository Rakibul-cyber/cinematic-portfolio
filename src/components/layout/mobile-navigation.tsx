"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { navigation } from "@/content/site";

/**
 * Mobile primary navigation.
 *
 * Interaction is genuine, so this stays a Client Component: it traps focus
 * while open, closes on Escape, restores focus to the toggle, and locks body
 * scroll. `tagline` is passed in from the Server Component header so the CMS
 * value never requires a client-side fetch.
 */
export function MobileNavigation({ tagline }: { tagline: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close the panel whenever a navigation actually completes.
  useEffect(() => setIsOpen(false), [pathname]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const toggleElement = toggleRef.current;
    document.body.style.overflow = "hidden";
    firstLinkRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab" || !rootRef.current) return;

      const focusableElements = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      const firstElement = focusableElements.at(0);
      const lastElement = focusableElements.at(-1);

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      toggleElement?.focus();
    };
  }, [isOpen]);

  return (
    <div className="md:hidden" ref={rootRef}>
      <button
        aria-controls="mobile-navigation"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close navigation" : "Open navigation"}
        className="relative z-20 inline-flex size-12 items-center justify-center text-foreground transition-colors hover:text-accent"
        onClick={() => setIsOpen((current) => !current)}
        ref={toggleRef}
        type="button"
      >
        {isOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
      </button>

      {isOpen ? (
        <div
          className="fixed inset-x-0 top-[var(--header-height)] bottom-0 z-10 border-t border-border bg-background"
          id="mobile-navigation"
        >
          <nav
            aria-label="Mobile navigation"
            className="flex h-full flex-col justify-between px-5 py-10 sm:px-8"
          >
            <ul className="space-y-1">
              {navigation.map((item, index) => (
                <li key={item.href}>
                  <Link
                    aria-current={pathname === item.href ? "page" : undefined}
                    className="flex min-h-16 items-center justify-between border-b border-border font-display text-4xl tracking-[-0.02em] transition-colors hover:text-accent"
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    ref={index === 0 ? firstLinkRef : undefined}
                  >
                    {item.label}
                    <span
                      aria-hidden="true"
                      className="font-sans text-[0.625rem] tracking-[0.16em] text-muted-foreground"
                    >
                      0{index + 1}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {tagline ? (
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                {tagline}
              </p>
            ) : null}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
