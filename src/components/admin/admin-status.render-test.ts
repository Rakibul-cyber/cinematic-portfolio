import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { AdminErrorView as AdminErrorViewType } from "@/components/admin/admin-error-view";
import type { AdminNavLink as AdminNavLinkType } from "@/components/admin/admin-nav-link";
import type { AdminNotFoundView as AdminNotFoundViewType } from "@/components/admin/admin-status";
import type { AdminForbiddenView as AdminForbiddenViewType } from "@/components/admin/admin-status";

/**
 * Admin loading, error and not-found states: what they show, what they must
 * never show, keyboard focus, retry, and how they sit alongside the
 * authentication checks. Server-only wiring (the catch-all and the boundary
 * itself) is asserted from source, as elsewhere in this suite.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let AdminErrorView: typeof AdminErrorViewType;
let AdminNavLink: typeof AdminNavLinkType;
let AdminNotFoundView: typeof AdminNotFoundViewType;
let AdminForbiddenView: typeof AdminForbiddenViewType;

before(async () => {
  // `self` because next/link schedules prefetching through `self.requestIdleCallback`, as in a browser.
  const globals: Globals = { window: dom.window, self: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  const React = await import("react");
  ({ act, createElement } = React);
  // See turnstile-widget.render-test.ts for why `React` must be a global here.
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ AdminErrorView } = await import("@/components/admin/admin-error-view"));
  ({ AdminNavLink } = await import("@/components/admin/admin-nav-link"));
  ({ AdminForbiddenView, AdminNotFoundView } = await import("@/components/admin/admin-status"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

/** Markers of the signed-in admin chrome, which none of these screens may carry. */
const PRIVATE_CHROME = /Sign out|SUPER_ADMIN|ADMIN ·|EDITOR|@[a-z0-9.-]+\.[a-z]{2,}/;

describe("admin loading feedback", () => {
  const html = () => renderToStaticMarkup(createElement(AdminNavLink, { className: "c", href: "/admin/inquiries", children: "Inquiries" }));

  it("is an ordinary link to the admin page, with its label as the visible text", () => {
    assert.match(html(), /^<a class="c" href="\/admin\/inquiries">Inquiries/);
  });

  it("holds an empty polite live region ready to announce Loading, and shows nothing while idle", () => {
    assert.match(html(), /<span aria-live="polite" class="sr-only"><\/span>/);
    assert.match(html(), /<span aria-hidden="true" class="hidden"><\/span>/);
  });

  it("shows a decorative accent marker and announces Loading… only while its navigation is pending", () => {
    const source = readFileSync("src/components/admin/admin-nav-link.tsx", "utf8");
    assert.match(source, /const \{ pending \} = useLinkStatus\(\);/);
    assert.match(source, /pending \? "ml-2 inline-block size-1\.5 bg-accent align-middle motion-safe:animate-pulse" : "hidden"/);
    assert.match(source, /\{pending \? "Loading…" : ""\}/);
  });

  it("is used for the admin sidebar and the 404 shortcuts", () => {
    assert.match(readFileSync("src/components/admin/admin-shell.tsx", "utf8"), /<AdminNavLink\s/);
    assert.match(readFileSync("src/components/admin/admin-status.tsx", "utf8"), /<AdminNavLink\s/);
  });

  it("never comes from a route-level loading boundary, which would turn auth redirects and 404s into streamed 200s", () => {
    // A loading.tsx at or above an admin page streams it: the 200 status and the
    // fallback are flushed before requireUser() or notFound() can answer, so a
    // forged-cookie visit gets a client-side refresh instead of a redirect
    // (`npm run auth:verify` step 2) and a missing record answers 200.
    for (const file of ["src/app/(admin)/loading.tsx", "src/app/(admin)/admin/loading.tsx"]) assert.ok(!existsSync(file), file);
  });
});

describe("admin not-found state", () => {
  const html = () => renderToStaticMarkup(createElement(AdminNotFoundView));

  it("says plainly that the page or item is missing", () => {
    assert.match(html(), /<h1[^>]*>Page not found<\/h1>/);
    assert.match(html(), /may have been deleted/);
  });

  it("offers labelled navigation back into the admin area", () => {
    assert.match(html(), /<nav aria-label="Admin shortcuts"/);
    for (const href of ["/admin", "/admin/inquiries", "/admin/projects", "/admin/media"]) assert.match(html(), new RegExp(`href="${href}"`));
  });

  it("carries no user details and none of the public site's chrome", () => {
    assert.doesNotMatch(html(), PRIVATE_CHROME);
    assert.doesNotMatch(html(), /Skip to content|Primary navigation/);
  });
});

describe("admin forbidden state", () => {
  const html = () => renderToStaticMarkup(createElement(AdminForbiddenView));

  it("states the denial without exposing protected or internal details", () => {
    assert.match(html(), /<h1[^>]*>Access denied<\/h1>/);
    assert.match(html(), /does not have permission/);
    assert.doesNotMatch(html(), PRIVATE_CHROME);
    assert.doesNotMatch(html(), /AuthorizationError|Requires role|Reference:|digest|stack/i);
  });

  it("offers a safe route back to the admin dashboard", () => {
    assert.match(html(), /href="\/admin"/);
    assert.match(html(), /Back to dashboard/);
  });
});

describe("admin error state", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  async function mount(props: { digest?: string; retrying?: boolean; onRetry?: () => void }) {
    container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(AdminErrorView, { onRetry: () => {}, retrying: false, ...props })));
  }
  async function unmount() {
    await act(async () => root.unmount());
    container.remove();
  }

  it("moves keyboard focus to its heading, which is not an extra Tab stop", async () => {
    await mount({});
    const heading = container.querySelector("h1")!;
    assert.equal(dom.window.document.activeElement, heading);
    assert.equal(heading.getAttribute("tabindex"), "-1");
    assert.equal(heading.textContent, "This page could not be shown");
    await unmount();
  });

  it("covers both a failure and a role denial without claiming which", async () => {
    await mount({});
    assert.match(container.textContent ?? "", /unexpected problem.*or your account may not have access/);
    await unmount();
  });

  it("offers a real retry button and a dashboard link", async () => {
    let retries = 0;
    await mount({ onRetry: () => retries++ });
    const button = container.querySelector("button")!;
    assert.equal(button.type, "button");
    assert.equal(button.textContent, "Try again");
    await act(async () => button.click());
    assert.equal(retries, 1);
    assert.equal(container.querySelector('a[href="/admin"]')?.textContent, "Back to dashboard");
    await unmount();
  });

  it("disables the retry while one is in progress", async () => {
    await mount({ retrying: true });
    const button = container.querySelector("button")!;
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "Trying again…");
    await unmount();
  });

  it("shows the opaque digest as a support reference, and nothing when there is none", async () => {
    await mount({ digest: "4242424242" });
    assert.match(container.textContent ?? "", /Reference: 4242424242/);
    await unmount();
    await mount({});
    assert.doesNotMatch(container.textContent ?? "", /Reference/);
    await unmount();
  });

  it("has no way to receive an error message, stack or user: only a digest", () => {
    const source = readFileSync("src/components/admin/admin-error-view.tsx", "utf8");
    assert.match(source, /AdminErrorView\(\{ digest, onRetry, retrying \}: \{ digest\?: string; onRetry: \(\) => void; retrying: boolean \}\)/);
    assert.doesNotMatch(source, /\.message|\.stack|user\./);
  });
});

describe("admin boundary wiring", () => {
  const boundary = readFileSync("src/app/(admin)/admin/error.tsx", "utf8");

  it("passes only the digest to the screen, never the message or stack", () => {
    assert.match(boundary, /<AdminErrorView\s+digest=\{error\.digest\}/);
    const jsx = boundary.slice(boundary.indexOf("return ("));
    assert.doesNotMatch(jsx, /error\.(message|stack)/);
  });

  it("refreshes the server render and resets the boundary when retrying", () => {
    assert.match(boundary, /startTransition\(\(\) => \{\s*router\.refresh\(\);\s*reset\(\);\s*\}\)/);
  });

  it("reports through the shared helper, tagged as the admin boundary", () => {
    assert.match(boundary, /reportBoundaryError\(error, "admin"\)/);
  });

  it("uses the neutral not-found screen", () => {
    assert.match(readFileSync("src/app/(admin)/admin/not-found.tsx", "utf8"), /<AdminNotFoundView \/>/);
  });
});

describe("unknown admin addresses", () => {
  const source = readFileSync("src/app/(admin)/admin/[...missing]/page.tsx", "utf8");

  it("requires a signed-in user before revealing that the page does not exist", () => {
    const auth = source.indexOf("await requireUser(");
    const missing = source.indexOf("notFound();");
    assert.ok(auth > 0 && missing > auth, "requireUser runs before notFound");
  });

  it("returns the visitor to the address they asked for after signing in, encoded segment by segment", () => {
    assert.match(source, /requireUser\(`\/admin\/\$\{missing\.map\(encodeURIComponent\)\.join\("\/"\)\}`\)/);
  });

  it("is rendered per request, never cached", () => {
    assert.match(source, /export const dynamic = "force-dynamic"/);
  });

  it("leaves the existing auth layers in place: middleware covers every /admin path and the layout stays auth-free for /admin/login", () => {
    assert.match(readFileSync("src/middleware.ts", "utf8"), /matcher: \["\/admin", "\/admin\/:path\*"\]/);
    assert.doesNotMatch(readFileSync("src/app/(admin)/admin/layout.tsx", "utf8"), /requireUser|requireRole/);
  });
});
