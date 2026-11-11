import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

/**
 * Admin edit forms selected by a query parameter (`?edit=` / `?editSocial=`).
 *
 * Moving between edit targets only changes search params, so Next.js
 * re-renders the page without remounting it, and React patches the existing
 * uncontrolled fields. A textarea or a `defaultChecked` checkbox then keeps the
 * previous record's value, and saving writes it into the newly selected record
 * (QA: a description copied across records; an inactive service silently
 * reactivated). Each such form is keyed by the record it edits, so every target
 * and create mode get freshly mounted fields.
 *
 * The pages are async Server Components that query the database, so the
 * mechanism is exercised here with the same field types and keying, and the
 * pages' wiring is asserted from source, as elsewhere in this suite.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/services", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;

before(async () => {
  const globals: Globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  const React = await import("react");
  ({ act, createElement } = React);
  ({ createRoot } = await import("react-dom/client"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

type Row = { id: string; name: string; description: string | null; isActive: boolean };
const WEDDINGS: Row = { id: "a", name: "Weddings", description: "Wedding work.", isActive: true };
const COMMERCIAL: Row = { id: "b", name: "Commercial", description: null, isActive: true };
const ARCHIVE: Row = { id: "c", name: "Archive", description: "Old work.", isActive: false };

/** A list page's form fields, keyed as the page keys it (or not, to show the defect). */
function form(current: Row | undefined, keyed: boolean) {
  return createElement(
    "form",
    keyed ? { key: current?.id ?? "new" } : {},
    current ? createElement("input", { type: "hidden", name: "id", value: current.id }) : null,
    createElement("input", { name: "name", defaultValue: current?.name }),
    createElement("textarea", { name: "description", defaultValue: current?.description ?? "" }),
    createElement("input", { name: "isActive", type: "checkbox", defaultChecked: current?.isActive ?? true }),
  );
}

async function navigate(keyed: boolean, ...targets: (Row | undefined)[]) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  for (const target of targets) await act(async () => root.render(form(target, keyed)));
  const el = container.querySelector("form")!;
  const fields = {
    id: (el.querySelector("[name=id]") as HTMLInputElement | null)?.value ?? null,
    name: (el.querySelector("[name=name]") as HTMLInputElement).value,
    description: (el.querySelector("[name=description]") as HTMLTextAreaElement).value,
    isActive: (el.querySelector("[name=isActive]") as HTMLInputElement).checked,
  };
  await act(async () => root.unmount());
  container.remove();
  return fields;
}

describe("switching between edit targets", () => {
  it("reproduces the defect without a key: the textarea and checkbox keep the previous record's values", async () => {
    // Whether a pristine text input follows its new defaultValue differs between
    // DOM implementations (Edge: yes, jsdom: no); these two are stale in both.
    const fields = await navigate(false, WEDDINGS, ARCHIVE);
    assert.notDeepEqual(fields, await navigate(false, ARCHIVE));
    assert.equal(fields.description, "Wedding work.");
    assert.equal(fields.isActive, true);
  });

  it("shows every field of the newly selected record: Edit A then Edit B", async () => {
    assert.deepEqual(await navigate(true, WEDDINGS, COMMERCIAL), { id: "b", name: "Commercial", description: "", isActive: true });
    assert.deepEqual(await navigate(true, WEDDINGS, ARCHIVE), { id: "c", name: "Archive", description: "Old work.", isActive: false });
  });

  it("keeps an inactive record inactive when opened from the create form", async () => {
    assert.deepEqual(await navigate(true, undefined, ARCHIVE), { id: "c", name: "Archive", description: "Old work.", isActive: false });
  });

  it("returns to an empty, active create form after editing", async () => {
    assert.deepEqual(await navigate(true, ARCHIVE, undefined), { id: null, name: "", description: "", isActive: true });
  });

  it("matches a full page load of the same target", async () => {
    assert.deepEqual(await navigate(true, WEDDINGS, ARCHIVE), await navigate(true, ARCHIVE));
  });
});

describe("admin forms selected by a query parameter", () => {
  const forms = [
    ["services", "src/app/(admin)/admin/services/page.tsx", "saveServiceAction", "current"],
    ["social links", "src/app/(admin)/admin/settings/page.tsx", "saveSocialAction", "currentSocial"],
  ] as const;

  for (const [label, file, action, record] of forms) {
    it(`keys the ${label} form by the record it edits`, () => {
      const source = readFileSync(file, "utf8");
      const start = source.indexOf(`action={${action}}`);
      assert.ok(start > 0, `${action} form present`);
      const open = Math.max(source.lastIndexOf("<form", start), source.lastIndexOf("<AdminForm", start));
      const tag = source.slice(open, source.indexOf(">", start) + 1);
      assert.match(tag, new RegExp(`key=\\{${record}\\?\\.id \\?\\? "new"\\}`));
    });
  }

  it("covers every admin page that picks its edit target from search params", () => {
    for (const [, file] of forms) assert.match(readFileSync(file, "utf8"), /searchParams/);
    // Project, customer and inquiry edit pages select their record by route
    // segment, which already remounts the page for each record.
    for (const file of ["src/app/(admin)/admin/projects/[id]/page.tsx", "src/app/(admin)/admin/customers/[id]/page.tsx", "src/app/(admin)/admin/inquiries/[id]/page.tsx"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /searchParams:\s*Promise<\{[^}]*edit/);
    }
  });
});
