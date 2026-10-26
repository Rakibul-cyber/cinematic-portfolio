import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { AdminForm as AdminFormType } from "@/components/admin/admin-form";
import { describeValidationError, type AdminFormState } from "@/lib/admin/form-state";
import { anonymizeCustomerSchema } from "@/lib/validation/crm";

/**
 * What an administrator sees and where focus goes when a scoped admin
 * operation is refused for an expected reason (QA Fix C): the customer edit,
 * the anonymization confirmation and the image delete. The forms are built the
 * way the pages build them, around the real `AdminForm`; the server answers are
 * the ones the actions return.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/customers/c1", pretendToBeVisual: true });
type Globals = Record<string, unknown>;
const replaced: Globals = {};
let act: typeof import("react").act;
let h: typeof import("react").createElement;
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
  ({ act, createElement: h } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ AdminForm } = await import("@/components/admin/admin-form"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

/** Mounts `children` in an AdminForm whose action answers with `respond`. */
async function mount(respond: (form: FormData) => AdminFormState, ...children: ReturnType<typeof h>[]) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const action = async (_state: AdminFormState, form: FormData) => respond(form);
  await act(async () => root.render(h(AdminForm, { action, className: "grid" }, ...children)));
  const form = container.querySelector("form")!;
  return {
    form,
    input: (name: string) => form.querySelector(`[name=${name}]`) as HTMLInputElement,
    alert: () => form.querySelector("[role=alert]"),
    /** Submits with the given button focused, as a keyboard user would. */
    submit: (button = form.querySelector("button")!) =>
      act(async () => {
        button.focus();
        form.requestSubmit(button);
      }),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const field = (label: string, name: string, value: string, type = "text") => h("label", { key: name }, label, h("input", { name, defaultValue: value, type }));

describe("duplicate customer email", () => {
  const customerForm = (respond: (form: FormData) => AdminFormState) =>
    mount(
      respond,
      h("input", { type: "hidden", name: "id", value: "c1", key: "id" }),
      field("Name", "name", "Synthetic Customer"),
      field("Email", "email", "synthetic@example.test", "email"),
      field("Company", "company", ""),
      h("button", { key: "save" }, "Save customer"),
    );

  it("names the email field, focuses it and keeps everything typed", async () => {
    const f = await customerForm(() => ({ error: "Another customer already uses this email address.", field: "email" }));
    f.input("name").value = "Renamed Customer";
    f.input("email").value = "taken@example.test";
    f.input("company").value = "Synthetic Studio";
    await f.submit();
    const alert = f.alert()!;
    assert.equal(alert.textContent, "Email: Another customer already uses this email address.");
    assert.equal(f.input("email").getAttribute("aria-invalid"), "true");
    assert.equal(f.input("email").getAttribute("aria-describedby"), alert.id);
    assert.equal(dom.window.document.activeElement, f.input("email"));
    assert.deepEqual([f.input("name").value, f.input("email").value, f.input("company").value], ["Renamed Customer", "taken@example.test", "Synthetic Studio"]);
    await f.unmount();
  });

  it("clears the message once a corrected save goes through", async () => {
    let call = 0;
    const f = await customerForm(() => (++call === 1 ? { error: "Another customer already uses this email address.", field: "email" } : null));
    await f.submit();
    f.input("email").value = "free@example.test";
    await f.submit();
    assert.equal(f.alert(), null);
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 0);
    await f.unmount();
  });
});

describe("incorrect anonymization confirmation", () => {
  it("explains the exact wording on the confirmation field and keeps focus there", async () => {
    const f = await mount(
      (form) => {
        const parsed = anonymizeCustomerSchema.safeParse(Object.fromEntries(form));
        return parsed.success ? null : describeValidationError(parsed.error);
      },
      h("input", { type: "hidden", name: "customerId", value: "00000000-0000-4000-8000-000000000001", key: "id" }),
      h("label", { key: "c" }, "Type ANONYMIZE to confirm", h("input", { name: "confirmation", autoComplete: "off" })),
      h("button", { key: "go" }, "Anonymize customer"),
    );
    f.input("confirmation").value = "anonymize";
    await f.submit();
    assert.equal(f.alert()!.textContent, "Type ANONYMIZE to confirm: Type ANONYMIZE exactly, in capital letters, to confirm.");
    assert.equal(f.input("confirmation").getAttribute("aria-invalid"), "true");
    assert.equal(dom.window.document.activeElement, f.input("confirmation"));
    assert.equal(f.input("confirmation").value, "anonymize");
    await f.unmount();
  });
});

describe("deleting an image that is in use", () => {
  it("announces the reason beside that image and leaves focus on its Delete button", async () => {
    const f = await mount(
      () => ({ error: "This image is assigned to a project. Remove it from the project before deleting it." }),
      h("input", { type: "hidden", name: "id", value: "m1", key: "id" }),
      h("button", { key: "delete" }, "Delete image and all variants"),
    );
    const button = f.form.querySelector("button")!;
    await f.submit(button);
    assert.equal(f.alert()!.textContent, "This image is assigned to a project. Remove it from the project before deleting it.");
    assert.ok(f.form.contains(f.alert()), "the message is inside this image's form");
    assert.equal(dom.window.document.activeElement, button);
    assert.equal(f.form.querySelectorAll("[aria-invalid]").length, 0);
    await f.unmount();
  });
});
