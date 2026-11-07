import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { AdminForm as AdminFormType } from "@/components/admin/admin-form";
import type { AdminFormState } from "@/lib/admin/form-state";

/**
 * Admin save forms after a rejected save: everything typed stays, the failing
 * field is named, marked and focused, and a later successful save resets the
 * form as before. The page wiring is asserted from source, as elsewhere in this
 * suite, because the pages are async Server Components that query the database.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/categories", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let AdminForm: typeof AdminFormType;

before(async () => {
  const w = dom.window;
  const globals: Globals = { window: w, document: w.document, Node: w.Node, HTMLElement: w.HTMLElement, HTMLInputElement: w.HTMLInputElement, HTMLTextAreaElement: w.HTMLTextAreaElement, HTMLSelectElement: w.HTMLSelectElement, HTMLFormElement: w.HTMLFormElement, FormData: w.FormData, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  const React = await import("react");
  ({ act, createElement } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ AdminForm } = await import("@/components/admin/admin-form"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

/** A category-like form; `respond` decides what the "server" returns for each submission. */
async function mount(respond: (form: FormData) => AdminFormState) {
  const received: FormData[] = [];
  const action = async (_state: AdminFormState, form: FormData) => {
    received.push(form);
    return respond(form);
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        AdminForm,
        { action, className: "grid" },
        createElement("input", { type: "hidden", name: "id", value: "c1" }),
        createElement("label", null, "Name", createElement("input", { name: "name", defaultValue: "" })),
        createElement("label", null, "Slug", createElement("input", { name: "slug", defaultValue: "", "aria-describedby": "slug-hint" })),
        createElement("p", { id: "slug-hint" }, "Lowercase letters, numbers and hyphens."),
        createElement("label", null, "Description", createElement("textarea", { name: "description", defaultValue: "" })),
        createElement("label", null, "Status", createElement("select", { name: "status", defaultValue: "DRAFT" }, createElement("option", null, "DRAFT"), createElement("option", null, "PUBLISHED"))),
        createElement("label", null, createElement("input", { name: "isActive", type: "checkbox", defaultChecked: true }), " Active"),
        createElement("button", null, "Save"),
      ),
    ),
  );
  const form = container.querySelector("form")!;
  const el = <T extends Element>(selector: string) => form.querySelector(selector) as unknown as T;
  return {
    form,
    received,
    el,
    fill(values: { name?: string; slug?: string; description?: string; status?: string; isActive?: boolean }) {
      if (values.name !== undefined) el<HTMLInputElement>("[name=name]").value = values.name;
      if (values.slug !== undefined) el<HTMLInputElement>("[name=slug]").value = values.slug;
      if (values.description !== undefined) el<HTMLTextAreaElement>("[name=description]").value = values.description;
      if (values.status !== undefined) el<HTMLSelectElement>("[name=status]").value = values.status;
      if (values.isActive !== undefined) el<HTMLInputElement>("[name=isActive]").checked = values.isActive;
    },
    values: () => ({
      name: el<HTMLInputElement>("[name=name]").value,
      slug: el<HTMLInputElement>("[name=slug]").value,
      description: el<HTMLTextAreaElement>("[name=description]").value,
      status: el<HTMLSelectElement>("[name=status]").value,
      isActive: el<HTMLInputElement>("[name=isActive]").checked,
    }),
    submit: () => act(async () => form.requestSubmit()),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const TYPED = { name: "QA Category", slug: "Bad Slug!", description: "Line one\nLine two", status: "PUBLISHED", isActive: false };

describe("a rejected save", () => {
  it("keeps every typed value: text, textarea, select and an unticked checkbox", async () => {
    const f = await mount(() => ({ error: "Use lowercase letters, numbers, and hyphens only.", field: "slug" }));
    f.fill(TYPED);
    await f.submit();
    assert.equal(f.received.length, 1);
    assert.equal(f.received[0].get("slug"), "Bad Slug!");
    assert.deepEqual(f.values(), TYPED);
    await f.unmount();
  });

  it("names the field in an alert inside the form, marks it invalid and focuses it", async () => {
    const f = await mount(() => ({ error: "Use lowercase letters, numbers, and hyphens only.", field: "slug" }));
    f.fill(TYPED);
    await f.submit();
    const alert = f.form.querySelector("[role=alert]")!;
    const slug = f.el<HTMLInputElement>("[name=slug]");
    assert.equal(alert.textContent, "Slug: Use lowercase letters, numbers, and hyphens only.");
    assert.equal(slug.getAttribute("aria-invalid"), "true");
    assert.deepEqual(slug.getAttribute("aria-describedby")!.split(" "), ["slug-hint", alert.id]);
    assert.equal(dom.window.document.activeElement, slug);
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 1);
    await f.unmount();
  });

  it("shows a form-level message without marking anything when no field is named", async () => {
    const f = await mount(() => ({ error: "This project changed in another session. Reload it before saving." }));
    f.fill(TYPED);
    await f.submit();
    assert.equal(f.form.querySelector("[role=alert]")!.textContent, "This project changed in another session. Reload it before saving.");
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 0);
    assert.deepEqual(f.values(), TYPED);
    await f.unmount();
  });

  it("does not mark or focus a hidden field", async () => {
    const f = await mount(() => ({ error: "Reload the project before saving.", field: "id" }));
    await f.submit();
    assert.equal(f.form.querySelector("[role=alert]")!.textContent, "Reload the project before saving.");
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 0);
    await f.unmount();
  });

  it("moves the mark to the new field when the next attempt fails elsewhere", async () => {
    let call = 0;
    const f = await mount(() => (++call === 1 ? { error: "Bad slug.", field: "slug" } : { error: "Use 100 characters or fewer.", field: "name" }));
    f.fill(TYPED);
    await f.submit();
    f.fill({ slug: "good-slug" });
    await f.submit();
    const slug = f.el<HTMLInputElement>("[name=slug]");
    assert.equal(slug.getAttribute("aria-invalid"), null);
    assert.equal(slug.getAttribute("aria-describedby"), "slug-hint");
    assert.equal(f.el<HTMLInputElement>("[name=name]").getAttribute("aria-invalid"), "true");
    assert.equal(f.form.querySelector("[role=alert]")!.textContent, "Name: Use 100 characters or fewer.");
    assert.deepEqual(f.values(), { ...TYPED, slug: "good-slug" });
    await f.unmount();
  });
});

describe("a rejected field inside a closed details section", () => {
  it("opens the section so the field can be focused", async () => {
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);
    const action = async () => ({ error: "A project with this slug already exists.", field: "slug" });
    await act(async () =>
      root.render(
        createElement(
          AdminForm,
          { action },
          createElement("label", null, "Title", createElement("input", { name: "title", defaultValue: "T" })),
          createElement(
            "details",
            null,
            createElement("summary", null, "Advanced details"),
            createElement("label", null, "Slug", createElement("input", { name: "slug", defaultValue: "taken" })),
          ),
          createElement("button", null, "Save"),
        ),
      ),
    );
    const form = container.querySelector("form")!;
    const details = form.querySelector("details")!;
    assert.equal(details.open, false);
    await act(async () => form.requestSubmit());
    assert.equal(details.open, true);
    assert.equal(dom.window.document.activeElement, form.querySelector("[name=slug]"));
    assert.equal(form.querySelector("[role=alert]")!.textContent, "Slug: A project with this slug already exists.");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("the project editor", () => {
  const source = readFileSync("src/components/admin/project-form.tsx", "utf8");
  const [visible, advanced] = source.split("<details className");

  it("shows only the everyday fields, with no provider or video ID input", () => {
    for (const name of ["title", "categoryId", "summary", "status"]) assert.match(visible, new RegExp(`name="${name}"`), name);
    assert.match(visible, /<ProjectVideoField/);
    assert.match(visible, /<ProjectMediaPicker/);
    assert.match(visible, /type="checkbox"\s+name="status"\s+value="PUBLISHED"/);
    assert.doesNotMatch(source, /name="videoProvider"|name="videoId"|Video provider|Video ID/);
  });

  it("keeps every advanced field in a details section that starts closed", () => {
    assert.ok(advanced, "advanced details section");
    assert.match(source, /<details className="[^"]*">/, "no open attribute");
    for (const name of ["slug", "description", "clientName", "location", "projectDate", "sortOrder", "featured", "seoTitle", "seoDescription"]) {
      assert.match(advanced, new RegExp(`name="${name}"`), name);
      assert.doesNotMatch(visible, new RegExp(`name="${name}"`), name);
    }
    assert.doesNotMatch(advanced, /\brequired\b/, "a closed section cannot show the browser's required-field prompt");
  });
});

describe("a successful save after a rejected one", () => {
  it("clears the message and the mark, and resets the form as before", async () => {
    let call = 0;
    const f = await mount(() => (++call === 1 ? { error: "Bad slug.", field: "slug" } : null));
    f.fill(TYPED);
    await f.submit();
    f.fill({ slug: "good-slug" });
    await f.submit();
    assert.equal(f.form.querySelector("[role=alert]"), null);
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 0);
    assert.deepEqual(f.values(), { name: "", slug: "", description: "", status: "DRAFT", isActive: true });
    await f.unmount();
  });
});

describe("admin save forms", () => {
  const forms = [
    ["src/app/(admin)/admin/categories/page.tsx", ["saveCategoryAction"]],
    ["src/app/(admin)/admin/services/page.tsx", ["saveServiceAction"]],
    ["src/app/(admin)/admin/testimonials/page.tsx", ["saveTestimonialAction"]],
    ["src/app/(admin)/admin/pages/page.tsx", ["savePageAction"]],
    ["src/app/(admin)/admin/settings/page.tsx", ["saveSettingsAction", "saveSocialAction"]],
    ["src/components/admin/project-form.tsx", ["saveProjectAction"]],
  ] as const;

  for (const [file, actions] of forms) {
    it(`${file.split("/").at(-2)}: ${actions.join(", ")} submit through AdminForm`, () => {
      const source = readFileSync(file, "utf8");
      for (const action of actions) {
        assert.match(source, new RegExp(`<AdminForm\\s[^>]*action=\\{${action}\\}`));
        assert.doesNotMatch(source, new RegExp(`<form\\s[^>]*action=\\{${action}\\}`));
      }
    });
  }

  it("save actions return failures as state instead of redirecting with the message", () => {
    const source = readFileSync("src/app/(admin)/admin/cms-actions.ts", "utf8");
    for (const [, actions] of forms) {
      for (const action of actions) {
        const body = source.slice(source.indexOf(`export async function ${action}(`));
        const end = body.indexOf("\nexport ", 1);
        const fn = end > 0 ? body.slice(0, end) : body;
        assert.match(fn, /\(\s*_state: AdminFormState,\s*form: FormData,?\s*\): Promise<AdminFormState>/, `${action} signature`);
        assert.match(fn, /return save\(/, `${action} uses save()`);
      }
    }
    const save = source.slice(source.indexOf("async function save("), source.indexOf("export async function"));
    assert.match(save, /catch \(error\) \{\s*return failure\(error\);\s*\}/);
  });
});
