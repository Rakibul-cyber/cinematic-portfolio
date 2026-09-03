"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

import { siteContent } from "@/content/site";

export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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
              {siteContent.navigation.map((item, index) => (
                <li key={item.href}>
                  <a
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
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
              {siteContent.brand.descriptor}
            </p>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
