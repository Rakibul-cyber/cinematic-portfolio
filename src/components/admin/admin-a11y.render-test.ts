import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { navCurrent as navCurrentType } from "@/components/admin/admin-nav-link";
import type { Notice as NoticeType } from "@/components/admin/admin-notice";
import type { ProjectMediaPicker as ProjectMediaPickerType } from "@/components/admin/project-media-picker";

/**
 * Admin accessibility (QA Fix D1): where the current page is in the
 * navigation, where focus goes after a notice, a failed sign-in or a change to
 * the project media list, and the names and semantics of the controls QA found
 * unlabelled. Client components run for real; the async Server Component pages
 * are asserted from source, as elsewhere in this suite.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/projects", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let h: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let navCurrent: typeof navCurrentType;
let Notice: typeof NoticeType;
let ProjectMediaPicker: typeof ProjectMediaPickerType;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;

before(async () => {
  const w = dom.window;
  // `self` because next/link schedules prefetching through `self.requestIdleCallback`, as in a browser.
  const globals: Globals = { window: w, self: w, document: w.document, Node: w.Node, HTMLElement: w.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  const React = await import("react");
  ({ act, createElement: h } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ navCurrent } = await import("@/components/admin/admin-nav-link"));
  ({ Notice } = await import("@/components/admin/admin-notice"));
  ({ ProjectMediaPicker } = await import("@/components/admin/project-media-picker"));
  ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

async function mount(element: ReturnType<typeof h>) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    render: (next: ReturnType<typeof h>) => act(async () => root.render(next)),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
const read = (file: string) => readFileSync(file, "utf8");
const active = () => dom.window.document.activeElement;

describe("current page in the admin navigation", () => {
  it("marks the page itself as the current page", () => {
    assert.equal(navCurrent("/admin", "/admin"), "page");
    assert.equal(navCurrent("/admin/projects", "/admin/projects"), "page");
  });

  it("marks the section of a nested page, but not as the page itself", () => {
    assert.equal(navCurrent("/admin/projects/abc", "/admin/projects"), "true");
    assert.equal(navCurrent("/admin/customers/abc", "/admin/customers"), "true");
  });

  it("never marks the dashboard for other pages, or a section by a shared prefix", () => {
    assert.equal(navCurrent("/admin/projects", "/admin"), undefined);
    assert.equal(navCurrent("/admin/projectsx", "/admin/projects"), undefined);
    assert.equal(navCurrent("/admin/inquiries", "/admin/projects"), undefined);
    assert.equal(navCurrent(null, "/admin/projects"), undefined);
  });

  it("is applied to every admin nav link, with a visible marker that is not colour of text alone", () => {
    assert.match(read("src/components/admin/admin-nav-link.tsx"), /<Link aria-current=\{navCurrent\(usePathname\(\), href\)\}/);
    assert.match(read("src/components/admin/admin-shell.tsx"), /border-l-2 border-transparent[^"]*\[&\[aria-current\]\]:border-accent/);
  });
});

describe("skip link", () => {
  const shell = read("src/components/admin/admin-shell.tsx");

  it("is the first thing in the admin shell and targets the main region", () => {
    const first = shell.slice(shell.indexOf("return ("));
    assert.ok(first.indexOf('<a className="skip-link" href="#main-content">') < first.indexOf("<aside"));
    assert.match(shell, /Skip to main content/);
  });

  it("lands focus in main, which is not itself a Tab stop", () => {
    assert.match(shell, /<main id="main-content" [^>]*tabIndex=\{-1\}>/);
  });

  it("reuses the public skip-link style, which is hidden until focused", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.skip-link \{[^}]*transform: translateY\(-150%\);/);
    assert.match(css, /\.skip-link:focus \{\s*transform: translateY\(0\);/);
  });
});

describe("page notices", () => {
  it("take focus when they appear, without becoming a Tab stop, and stay an alert", async () => {
    const m = await mount(h(Notice, { message: "This category still has projects. Move them to another category or delete them first." }));
    const notice = m.container.querySelector("p")!;
    assert.equal(notice.getAttribute("role"), "alert");
    assert.equal(notice.getAttribute("tabindex"), "-1");
    assert.equal(active(), notice);
    await m.unmount();
  });

  it("render nothing and move no focus without a message", async () => {
    const button = dom.window.document.createElement("button");
    dom.window.document.body.append(button);
    button.focus();
    const m = await mount(h(Notice, {}));
    assert.equal(m.container.innerHTML, "");
    assert.equal(active(), button);
    await m.unmount();
    button.remove();
  });

  it("take focus again for a different message", async () => {
    const m = await mount(h(Notice, { message: "Customer updated" }));
    const other = dom.window.document.createElement("button");
    dom.window.document.body.append(other);
    other.focus();
    await m.render(h(Notice, { message: "Note added" }));
    assert.equal(active(), m.container.querySelector("p"));
    await m.unmount();
    other.remove();
  });

  it("are the notice every admin page uses", () => {
    assert.match(read("src/components/admin/admin-shell.tsx"), /export \{ Notice \} from "@\/components\/admin\/admin-notice";/);
  });
});

describe("project media picker focus", () => {
  const media = ["a", "b", "c", "d", "e"].map((x) => ({ id: `m-${x}`, originalName: `${x}.jpg`, altText: `${x} alt`, thumbnailUrl: null }));
  // The picker refreshes the page after an upload, so it needs a router (MH-14).
  const router = { refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
  const picker = (selected: string[]) =>
    mount(h(AppRouterContext.Provider, { value: router as never }, h(ProjectMediaPicker, { initialMediaIds: selected, media })));
  const button = (c: HTMLElement, label: string) => c.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const press = (b: HTMLButtonElement) => act(async () => { b.focus(); b.click(); });
  const live = (c: HTMLElement) => c.querySelector("[aria-live=polite]")!.textContent;

  it("moves to the next image's Remove after a removal, and announces it", async () => {
    const m = await picker(["m-a", "m-b", "m-c"]);
    await press(button(m.container, "Remove b.jpg from project"));
    assert.equal(active(), button(m.container, "Remove c.jpg from project"));
    assert.equal(live(m.container), "b.jpg removed from project.");
    await m.unmount();
  });

  it("moves to the previous image's Remove when the last is removed", async () => {
    const m = await picker(["m-a", "m-b", "m-c"]);
    await press(button(m.container, "Remove c.jpg from project"));
    assert.equal(active(), button(m.container, "Remove b.jpg from project"));
    await m.unmount();
  });

  it("moves to the removed image's Add button when the list becomes empty", async () => {
    const m = await picker(["m-a"]);
    await press(button(m.container, "Remove a.jpg from project"));
    assert.equal(active(), button(m.container, "Add a.jpg to project"));
    await m.unmount();
  });

  it("keeps focus usable when a move disables the button that was pressed", async () => {
    const m = await picker(["m-a", "m-b", "m-c"]);
    await press(button(m.container, "Move b.jpg earlier"));
    assert.equal(active(), button(m.container, "Move b.jpg later"), "Up is now disabled at the top");
    assert.equal(live(m.container), "b.jpg moved to position 1 of 3.");
    await press(button(m.container, "Move a.jpg later"));
    await press(button(m.container, "Move a.jpg later"));
    assert.equal(active(), button(m.container, "Move a.jpg earlier"), "Down is now disabled at the bottom");
    await m.unmount();
  });

  it("leaves focus on a move button that stays enabled", async () => {
    const m = await picker(["m-a", "m-b", "m-c", "m-d"]);
    await press(button(m.container, "Move c.jpg earlier"));
    assert.equal(active(), button(m.container, "Move c.jpg earlier"));
    await m.unmount();
  });

  it("moves to the next available image's Add after adding one", async () => {
    const m = await picker(["m-a"]);
    await press(button(m.container, "Add c.jpg to project"));
    assert.equal(active(), button(m.container, "Add d.jpg to project"));
    assert.equal(live(m.container), "c.jpg added as image 2.");
    await press(button(m.container, "Add e.jpg to project"));
    assert.equal(active(), button(m.container, "Add d.jpg to project"), "previous one when the last is added");
    await m.unmount();
  });

  it("still submits the selection in display order", async () => {
    const m = await picker(["m-a", "m-b"]);
    await press(button(m.container, "Move b.jpg earlier"));
    assert.deepEqual([...m.container.querySelectorAll("input[name=mediaIds]")].map((i) => (i as HTMLInputElement).value), ["m-b", "m-a"]);
    await m.unmount();
  });
});

describe("failed sign-in focus", () => {
  const form = read("src/app/(admin)/admin/login/login-form.tsx");

  it("returns focus to the email field once the fields are enabled again", () => {
    assert.match(form, /useEffect\(\(\) => \{\s*if \(error && !isPending\) emailRef\.current\?\.focus\(\);\s*\}, \[error, isPending\]\);/);
    assert.match(form, /name="email"[^>]*ref=\{emailRef\}/);
  });

  it("keeps the field marked invalid and described by the one generic message", () => {
    assert.match(form, /aria-describedby=\{error \? errorId : undefined\}\s*aria-invalid=\{error \? true : undefined\}/);
    assert.match(form, /id=\{errorId\}\s*role="status"/);
  });
});

describe("labels and table semantics", () => {
  const inquiries = read("src/app/(admin)/admin/inquiries/page.tsx");
  const inquiry = read("src/app/(admin)/admin/inquiries/[id]/page.tsx");
  const customers = read("src/app/(admin)/admin/customers/page.tsx");
  const mediaPage = read("src/app/(admin)/admin/media/page.tsx");

  it("inquiry search and status filter have visible labels", () => {
    assert.match(inquiries, /<label className="grid gap-1 text-sm">Search inquiries<input [^>]*name="q"/);
    assert.match(inquiries, /<label className="grid gap-1 text-sm">Status<select [^>]*name="status"/);
    assert.match(inquiries, /<form aria-label="Filter inquiries" role="search"/);
  });

  it("the inquiry status update control has a visible label", () => {
    assert.match(inquiry, /<label className="grid gap-1 text-sm">Inquiry status<select [^>]*name="status"/);
  });

  it("customer search has a visible label", () => {
    assert.match(customers, /<label className="grid flex-1 gap-1 text-sm">Search customers<input [^>]*name="q"/);
  });

  it("the inquiry table has a caption describing the rows shown and column-scoped headers", () => {
    assert.match(inquiries, /const caption=`Inquiries\$\{status\?` with status \$\{status\}`:""\}\$\{q\?` matching “\$\{q\}”`:""\}, newest first, /);
    assert.match(inquiries, /<caption className="sr-only">\{caption\}<\/caption>/);
    assert.match(inquiries, /<th className="border-b p-3" key=\{x\} scope="col">/);
  });

  it("each image's Alt text and Caption fields are named after that image", () => {
    for (const label of ["Alt text", "Caption"]) {
      assert.match(mediaPage, new RegExp(`<span>\\s*${label}\\s*(?:\\{/\\*[^*]*\\*/\\}\\s*)?<span className="sr-only"> for \\{item\\.originalName\\}</span>\\s*</span>`));
    }
  });

  it("role-aware controls from Fix C are untouched", () => {
    assert.match(inquiries, /\{isAdministrative\(user\.role\)\?<Link [^>]*href="\/admin\/inquiries\/export">Export CSV<\/Link>:null\}/);
    assert.match(read("src/components/admin/admin-shell.tsx"), /\{adminLinksFor\(user\.role\)\.map\(/);
  });
});
