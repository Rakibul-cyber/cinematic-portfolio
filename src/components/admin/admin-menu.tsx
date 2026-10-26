"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// Set when a page is chosen from the open menu. Module-level because each
// admin page renders its own shell, so the menu on the next page is a new
// instance that has to pick this up.
let focusMainOnArrival = false;

/**
 * The admin sidebar's contents, collapsed behind a Menu button below `md`.
 *
 * A disclosure, not a dialog: the links push the page down rather than
 * covering it, so there is nothing to trap focus in. While closed on a narrow
 * screen they are `display: none` and out of the Tab order; from `md` up the
 * button is hidden and the sidebar shows as before. Escape closes and returns
 * focus to the button. Choosing a page closes the menu and moves focus to the
 * new page's main region, as the skip link does, since the link that held
 * focus is hidden with the menu. The desktop sidebar is not affected.
 *
 * The links themselves are rendered by the server shell, so the role-filtered
 * list is the same one desktop shows.
 */
export function AdminMenu({ header, children }: { header: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // A completed navigation closes the menu (state adjusted during render, not in an effect).
  if (pathname !== shownFor) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!focusMainOnArrival) return;
    focusMainOnArrival = false;
    document.getElementById("main-content")?.focus();
  }, [pathname]);

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        {header}
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground md:hidden"
          onClick={() => setOpen((value) => !value)}
          ref={buttonRef}
          type="button"
        >
          {open ? <X aria-hidden="true" className="size-4" strokeWidth={1.5} /> : <Menu aria-hidden="true" className="size-4" strokeWidth={1.5} />}
          Menu
        </button>
      </div>
      <div
        className={open ? undefined : "hidden md:block"}
        id={panelId}
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest("a[href]");
          if (!open || !(link instanceof HTMLAnchorElement)) return;
          if (link.pathname !== pathname) {
            focusMainOnArrival = true;
            return;
          }
          // The page already shown: nothing will navigate, so close here.
          setOpen(false);
          document.getElementById("main-content")?.focus();
        }}
      >
        {children}
      </div>
    </div>
  );
}
