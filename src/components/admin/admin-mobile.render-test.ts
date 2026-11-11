import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { AdminMenu as AdminMenuType } from "@/components/admin/admin-menu";
import type { AdminPagination as AdminPaginationType, pageHref as pageHrefType } from "@/components/admin/admin-pagination";
import type { DeleteButton as DeleteButtonType } from "@/components/admin/delete-button";
import type { Notice as NoticeType } from "@/components/admin/admin-notice";

/**
 * Admin mobile usability (QA Fix D2): the collapsible navigation, inquiry
 * cards, filter-keeping pagination, larger targets, Media inside the shared
 * shell, distinct names for repeated media actions, and which notices move
 * focus. Client components run for real; the async Server Component pages are
 * asserted from source, as elsewhere in this suite.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/inquiries", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let h: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let PathnameContext: import("react").Context<string | null>;
let AdminMenu: typeof AdminMenuType;
let AdminPagination: typeof AdminPaginationType;
let pageHref: typeof pageHrefType;
let DeleteButton: typeof DeleteButtonType;
let Notice: typeof NoticeType;

before(async () => {
  const w = dom.window;
  // `self` because next/link schedules prefetching through `self.requestIdleCallback`, as in a browser.
  const globals: Globals = { window: w, self: w, document: w.document, Node: w.Node, HTMLElement: w.HTMLElement, HTMLAnchorElement: w.HTMLAnchorElement, KeyboardEvent: w.KeyboardEvent, MouseEvent: w.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  const React = await import("react");
  ({ act, createElement: h } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  // The context `usePathname` reads, so a test can play the router's part.
  ({ PathnameContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime")) as unknown as { PathnameContext: import("react").Context<string | null> });
  ({ AdminMenu } = await import("@/components/admin/admin-menu"));
  ({ AdminPagination, pageHref } = await import("@/components/admin/admin-pagination"));
  ({ DeleteButton } = await import("@/components/admin/delete-button"));
  ({ Notice } = await import("@/components/admin/admin-notice"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

const read = (file: string) => readFileSync(file, "utf8");
const active = () => dom.window.document.activeElement;

async function mount(render: () => ReturnType<typeof h>) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(render()));
  return {
    container,
    rerender: () => act(async () => root.render(render())),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("mobile admin menu", () => {
  let pathname = "/admin/inquiries";
  const menu = () =>
    h(PathnameContext.Provider, { value: pathname },
      h("div", null,
        h(AdminMenu, {
          header: h("p", null, "Studio CMS"),
          children: h("nav", { "aria-label": "Admin" },
            h("a", { href: "/admin/inquiries" }, "Inquiries"),
            h("a", { href: "/admin/customers" }, "Customers"),
          ),
        }),
        h("main", { id: "main-content", tabIndex: -1 }, "content"),
      ),
    );
  const setup = async () => {
    pathname = "/admin/inquiries";
    const m = await mount(menu);
    const button = m.container.querySelector("button")!;
    const panel = dom.window.document.getElementById(button.getAttribute("aria-controls")!)!;
    const click = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })); });
    return { m, button, panel, click };
  };

  it("starts closed, hidden below md and shown from md, with a named button that controls it", async () => {
    const { m, button, panel } = await setup();
    assert.equal(button.textContent, "Menu");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(button.getAttribute("type"), "button");
    assert.match(button.className, /\bmd:hidden\b/);
    assert.equal(panel.className, "hidden md:block");
    assert.ok(panel.contains(m.container.querySelector("nav")));
    await m.unmount();
  });

  it("opens and closes from the button, keeping the same name", async () => {
    const { m, button, panel, click } = await setup();
    await click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(panel.className, "");
    assert.equal(button.textContent, "Menu");
    await click(button);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    await m.unmount();
  });

  it("closes on Escape and returns focus to the button", async () => {
    const { m, button, panel, click } = await setup();
    await click(button);
    const link = panel.querySelector("a")!;
    link.focus();
    await act(async () => { link.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(active(), button);
    await m.unmount();
  });

  it("ignores Escape while closed", async () => {
    const { m, button } = await setup();
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    outside.focus();
    await act(async () => { button.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(active(), outside);
    outside.remove();
    await m.unmount();
  });

  it("closes after choosing another page and moves focus to the new page's main region", async () => {
    const { m, button, panel, click } = await setup();
    await click(button);
    const customers = panel.querySelectorAll("a")[1];
    customers.addEventListener("click", (event) => event.preventDefault()); // jsdom would otherwise try to navigate
    await click(customers);
    assert.equal(button.getAttribute("aria-expanded"), "true", "stays open until the navigation completes");
    pathname = "/admin/customers";
    await m.rerender();
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(active(), dom.window.document.getElementById("main-content"));
    await m.unmount();
  });

  it("moves focus to main when the next page brings its own new menu", async () => {
    const { m, button, panel, click } = await setup();
    await click(button);
    const customers = panel.querySelectorAll("a")[1];
    customers.addEventListener("click", (event) => event.preventDefault());
    await click(customers);
    await m.unmount(); // each admin page renders its own shell
    pathname = "/admin/customers";
    const next = await mount(menu);
    assert.equal(active(), dom.window.document.getElementById("main-content"));
    assert.equal(next.container.querySelector("button")!.getAttribute("aria-expanded"), "false");
    await next.unmount();
  });

  it("leaves focus alone for links followed while the menu is closed (the desktop sidebar)", async () => {
    const { m, panel, click } = await setup();
    const customers = panel.querySelectorAll("a")[1];
    customers.addEventListener("click", (event) => event.preventDefault());
    await click(customers);
    await m.unmount();
    pathname = "/admin/customers";
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    outside.focus();
    const next = await mount(menu);
    assert.equal(active(), outside);
    outside.remove();
    await next.unmount();
  });

  it("closes at once when the current page is chosen, since nothing navigates", async () => {
    const { m, button, panel, click } = await setup();
    await click(button);
    const current = panel.querySelector("a")!;
    current.addEventListener("click", (event) => event.preventDefault());
    await click(current);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(active(), dom.window.document.getElementById("main-content"));
    await m.unmount();
  });

  it("wraps the shell's role-filtered navigation and sign-out, with the D1 skip link still first", () => {
    const shell = read("src/components/admin/admin-shell.tsx");
    assert.match(shell, /<AdminMenu[\s\S]*<nav[\s\S]*\{adminLinksFor\(user\.role\)\.map\([\s\S]*<form action=\{signOutAction\}[\s\S]*<\/AdminMenu>/);
    const body = shell.slice(shell.indexOf("return ("));
    assert.ok(body.indexOf('<a className="skip-link" href="#main-content">') < body.indexOf("<AdminMenu"));
    assert.match(shell, /<button className="inline-flex min-h-10 items-center text-sm underline">Sign out<\/button>/);
  });
});

describe("filter-keeping pagination", () => {
  it("keeps search and status, leaves out empty values and page 1", () => {
    assert.equal(pageHref({ q: "ada", status: "NEW" }, 2), "?q=ada&status=NEW&page=2");
    assert.equal(pageHref({ q: "ada", status: undefined }, 1), "?q=ada");
    assert.equal(pageHref({ q: undefined }, 1), "?");
    assert.equal(pageHref({ q: "a&b c" }, 3), "?q=a%26b+c&page=3");
  });

  it("renders labelled previous / next links with the position, and nothing for a single page", () => {
    const html = renderToStaticMarkup(h(AdminPagination, { page: 2, pageSize: 25, total: 60, filters: { q: "ada", status: "NEW" } }));
    assert.match(html, /^<nav aria-label="Pagination"/);
    assert.match(html, /rel="prev" href="\?q=ada&amp;status=NEW">Previous<span class="sr-only"> page<\/span><\/a>/);
    assert.match(html, /Page 2 of 3/);
    assert.match(html, /rel="next" href="\?q=ada&amp;status=NEW&amp;page=3">Next<span class="sr-only"> page<\/span><\/a>/);
    assert.match(html, /class="inline-flex min-h-11 items-center/);
    assert.equal(renderToStaticMarkup(h(AdminPagination, { page: 1, pageSize: 25, total: 10, filters: {} })), "");
  });

  it("still offers the way back from a page past the end, keeping the filters", () => {
    const html = renderToStaticMarkup(h(AdminPagination, { page: 3, pageSize: 25, total: 4, filters: { status: "NEW" } }));
    assert.match(html, /rel="prev" href="\?status=NEW">Previous/);
    assert.doesNotMatch(html, /rel="next"/);
  });

  it("is used by the inquiry and customer lists with their active filters", () => {
    assert.match(read("src/app/(admin)/admin/inquiries/page.tsx"), /<AdminPagination filters=\{\{q,status\}\} page=\{page\} pageSize=\{SIZE\} total=\{total\}\/>/);
    assert.match(read("src/app/(admin)/admin/customers/page.tsx"), /<AdminPagination filters=\{\{q\}\} page=\{page\} pageSize=\{SIZE\} total=\{total\}\/>/);
    for (const file of ["inquiries", "customers"]) assert.doesNotMatch(read(`src/app/(admin)/admin/${file}/page.tsx`), /href=\{`\?page=/);
  });
});

describe("inquiry list at narrow widths", () => {
  const source = read("src/app/(admin)/admin/inquiries/page.tsx");

  it("shows cards below lg and the table from lg, both named by the same caption", () => {
    assert.match(source, /<ul aria-label=\{caption\} className="grid gap-3 lg:hidden">/);
    assert.match(source, /<div className="hidden overflow-x-auto lg:block"><table/);
    assert.match(source, /<caption className="sr-only">\{caption\}<\/caption>/);
  });

  it("keeps status, contact and project details on every card", () => {
    const card = source.slice(source.indexOf('<ul aria-label={caption}'), source.indexOf("</ul>"));
    for (const part of ["<span className=\"sr-only\">Status: </span>{r.status}", "{r.nameSnapshot}", "{r.emailSnapshot}", "{r.projectType}", "{r.serviceNameSnapshot??\"—\"}", "{r.createdAt.toLocaleDateString()}", "href={`/admin/inquiries/${r.id}`}"]) {
      assert.ok(card.includes(part), part);
    }
  });

  it("still runs the same query and keeps the Fix C export rule", () => {
    assert.match(source, /prisma\.inquiry\.findMany\(\{where,orderBy:\[\{createdAt:"desc"\},\{id:"desc"\}\],skip:\(page-1\)\*SIZE,take:SIZE,/);
    assert.match(source, /\{isAdministrative\(user\.role\)\?<a [^>]*href="\/admin\/inquiries\/export">Export CSV<\/a>:null\}/);
  });
});

describe("media page in the shared shell", () => {
  const source = read("src/app/(admin)/admin/media/page.tsx");

  it("requires a user first, then renders inside AdminShell with no main or header of its own", () => {
    assert.match(source, /const user = await requireUser\(ADMIN_MEDIA_PATH\);/);
    assert.ok(source.indexOf("requireUser(ADMIN_MEDIA_PATH)") < source.indexOf("prisma.media.findMany"));
    assert.match(source, /<AdminShell user=\{user\} title="Media library">/);
    assert.doesNotMatch(source, /<main|<header|Admin home/);
  });

  it("names Save metadata and Delete after the image", () => {
    assert.match(source, /Save metadata\s*<span className="sr-only"> for \{item\.originalName\}<\/span>/);
    assert.match(source, /<DeleteButton itemName=\{item\.originalName\}>Delete image and all variants<\/DeleteButton>/);
  });
});

describe("delete buttons", () => {
  it("add the item's name for assistive technology without changing the visible text", () => {
    const html = renderToStaticMarkup(h(DeleteButton, { itemName: "fixture-image-1.jpg" }, "Delete image and all variants"));
    assert.match(html, /^<button class="[^"]+">Delete image and all variants<span class="sr-only">: fixture-image-1\.jpg<\/span><\/button>$/);
    assert.equal(renderToStaticMarkup(h(DeleteButton, {})).replace(/<[^>]+>/g, ""), "Delete");
  });
});

describe("notices: errors are alerts, ordinary outcomes are polite", () => {
  it("a status notice is polite and neutral, and takes focus because the page it returns to is new", async () => {
    const m = await mount(() => h(Notice, { message: "Status updated", tone: "status" }));
    const notice = m.container.querySelector("p")!;
    assert.equal(notice.getAttribute("role"), "status");
    assert.equal(notice.getAttribute("aria-live"), "polite");
    assert.match(notice.className, /\bborder-border\b/);
    assert.equal(notice.getAttribute("tabindex"), "-1");
    assert.equal(active(), notice);
    await m.unmount();
  });

  it("an alert notice is assertive, accented, and takes focus", async () => {
    const m = await mount(() => h(Notice, { message: "Move them first." }));
    const notice = m.container.querySelector("p")!;
    assert.equal(notice.getAttribute("role"), "alert");
    assert.equal(notice.hasAttribute("aria-live"), false);
    assert.match(notice.className, /\bborder-accent\b/);
    await m.unmount();
  });

  it("an alert notice still takes focus (the default)", async () => {
    const m = await mount(() => h(Notice, { message: "This image is used by a project. Remove it from the project first." }));
    assert.equal(active(), m.container.querySelector("[role=alert]"));
    await m.unmount();
  });

  it("an informational outcome is polite and keeps redirect focus behavior", async () => {
    const m = await mount(() => h(Notice, { message: "Email is not configured, so nothing was sent", tone: "status" }));
    const notice = m.container.querySelector("[role=status]")!;
    assert.equal(notice.getAttribute("aria-live"), "polite");
    assert.equal(active(), notice);
    await m.unmount();
  });

  it("uses explicit outcome channels instead of inferring severity from message wording", () => {
    for (const file of ["customers/[id]/page.tsx", "inquiries/[id]/page.tsx"]) {
      const source = read(`src/app/(admin)/admin/${file}`);
      assert.match(source, /message=\{notice\.error\?\?notice\.info\?\?notice\.saved\}/);
      assert.match(source, /tone=\{notice\.error\?"alert":"status"\}/);
    }
    for (const file of ["projects/page.tsx", "services/page.tsx", "settings/page.tsx", "pages/page.tsx"]) assert.match(read(`src/app/(admin)/admin/${file}`), /<Notice message=\{error\} \/>/);
  });

  it("routes accepted, neutral, failed, and domain outcomes through the correct trusted channel", () => {
    const actions = read("src/app/(admin)/admin/crm-actions.ts");
    const recovery = read("src/server/email/recovery-workflow.ts");
    assert.match(recovery, /delivery\.status === "ACCEPTED" \? "saved" : delivery\.status === "SKIPPED" \? "info" : "error"/);
    assert.match(recovery, /error instanceof DeliveryNotRetryableError \? error\.message : fallback/);
    assert.match(actions, /\?\$\{outcome\}=\$\{encodeURIComponent\(notice\)\}/);
    assert.match(actions, /\?error=Customer\+is\+anonymized/);
    assert.doesNotMatch(actions, /provider[^\n]*(message|detail)[^\n]*notice/i);
  });
});

describe("record-specific admin action names", () => {
  const cases = [
    ["projects/page.tsx", "project", "r.title"],
    ["services/page.tsx", "service", "r.name"],
  ] as const;

  it("names every repeated Edit and Delete control after its record and stable id", () => {
    for (const [file, kind, field] of cases) {
      const source = read(`src/app/(admin)/admin/${file}`);
      assert.ok(source.includes(`aria-label={\`Edit ${kind} \${${field}} (\${r.id})\`}`), file);
      assert.ok(source.includes(`itemName={\`${kind} \${${field}} (\${r.id})\`}`), file);
    }
  });

  it("keeps Delete controls role-gated and server authorization unchanged", () => {
    for (const [file] of cases) {
      const source = read(`src/app/(admin)/admin/${file}`);
      assert.match(source, /const canDelete = isAdministrative\(user\.role\)/);
      assert.match(source, /\{canDelete \? \(/);
    }
    assert.match(read("src/app/(admin)/admin/cms-actions.ts"), /export async function deleteAction[\s\S]*const actor = await requireAdmin\("\/admin"\)/);
  });
});
