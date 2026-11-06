import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { isLaterMediaOperation as Predicate } from "@/app/(admin)/admin/media/upload-form";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const replaced: Record<string, unknown> = {};
let isLaterMediaOperation: typeof Predicate;

before(async () => {
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLFormElement: dom.window.HTMLFormElement,
  })) {
    replaced[key] = (globalThis as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = value;
  }
  ({ isLaterMediaOperation } = await import("@/app/(admin)/admin/media/upload-form"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) {
    (globalThis as Record<string, unknown>)[key] = value;
  }
  dom.window.close();
});

describe("media upload notice ownership", () => {
  it("identifies only later forms inside the media library", () => {
    const upload = dom.window.document.createElement("form");
    const library = dom.window.document.createElement("section");
    library.dataset.mediaLibrary = "";
    const metadata = dom.window.document.createElement("form");
    const field = dom.window.document.createElement("input");
    metadata.append(field);
    library.append(metadata);

    assert.equal(isLaterMediaOperation(metadata, upload), true);
    assert.equal(isLaterMediaOperation(field, upload), true);
    assert.equal(isLaterMediaOperation(upload, upload), false);
    assert.equal(isLaterMediaOperation(dom.window.document.body, upload), false);
  });

  it("clears upload feedback for submitted and browser-rejected later operations", () => {
    const source = readFileSync("src/app/(admin)/admin/media/upload-form.tsx", "utf8");
    assert.match(source, /addEventListener\("submit", clearStaleNotice, true\)/);
    assert.match(source, /addEventListener\("invalid", clearStaleNotice, true\)/);
    assert.match(source, /if \(isLaterMediaOperation\(event\.target, formRef\.current\)\) setNotice\(null\)/);
  });

  it("keeps upload success polite and reports upload failures as alerts", () => {
    const source = readFileSync("src/app/(admin)/admin/media/upload-form.tsx", "utf8");
    assert.match(source, /message: "Image uploaded successfully\."[\s\S]*tone: "status"/);
    assert.match(source, /result\.message \?\? uploadFailureMessage\(response\.status\)[\s\S]*tone: "alert"/);
    assert.match(source, /role=\{notice\?\.tone \?\? "status"\}/);
    assert.match(source, /aria-live=\{notice\?\.tone === "alert" \? undefined : "polite"\}/);
  });

  it("still uploads through the unchanged authenticated route", () => {
    const source = readFileSync("src/app/(admin)/admin/media/upload-form.tsx", "utf8");
    assert.match(source, /fetch\("\/api\/media", \{\s*method: "POST",\s*body: data,/);
    const route = readFileSync("src/app/api/media/route.ts", "utf8");
    assert.match(route, /const user = await getCurrentUser\(\);\s*if \(!user\)/);
  });

  it("leaves metadata persistence and authorization on the existing server action", () => {
    const page = readFileSync("src/app/(admin)/admin/media/page.tsx", "utf8");
    const actions = readFileSync("src/app/(admin)/admin/media/actions.ts", "utf8");
    assert.match(page, /action=\{updateMediaMetadataAction\}/);
    assert.match(page, /data-media-library/);
    assert.match(actions, /updateMediaMetadataAction[\s\S]*requireUser\(ADMIN_MEDIA_PATH\)/);
    assert.match(actions, /await updateMediaMetadata\(/);
  });
});

/**
 * The mounted form (P0-2): the selected photo is prepared in the browser before
 * upload, the prepared file is what reaches `/api/media`, and preparation or
 * server failures read as alerts. The canvas codec is replaced through the
 * `prepareFile` prop because jsdom has no image decoding; its logic is covered
 * by `src/lib/media-upload.test.ts`.
 */
describe("the mounted upload form", () => {
  type Globals = Record<string, unknown>;
  type Prepared = { file: File; resized: boolean };
  const w = dom.window;
  const mountedReplaced: Globals = {};
  let act: typeof import("react").act;
  let createElement: typeof import("react").createElement;
  let createRoot: typeof import("react-dom/client").createRoot;
  let UploadForm: typeof import("@/app/(admin)/admin/media/upload-form").UploadForm;
  let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
  let UploadPreparationError: typeof import("@/lib/media-upload").UploadPreparationError;
  let selected: File | null = null;

  const jpeg = (name: string, bytes = 64) => new w.File([new Uint8Array(bytes)], name, { type: "image/jpeg" }) as unknown as File;

  before(async () => {
    // FormData(form) cannot read a programmatically chosen file in jsdom, so the
    // selection is injected; everything after `new FormData(form)` is real.
    class SelectedFormData extends w.FormData {
      constructor(form?: HTMLFormElement) {
        super(form);
        if (selected) this.set("file", selected, selected.name);
      }
    }
    const globals: Globals = {
      Node: w.Node,
      HTMLElement: w.HTMLElement,
      HTMLInputElement: w.HTMLInputElement,
      HTMLButtonElement: w.HTMLButtonElement,
      File: w.File,
      Blob: w.Blob,
      FormData: SelectedFormData,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const [key, value] of Object.entries(globals)) {
      mountedReplaced[key] = (globalThis as Globals)[key];
      (globalThis as Globals)[key] = value;
    }
    const React = await import("react");
    ({ act, createElement } = React);
    mountedReplaced.React = (globalThis as Globals).React;
    (globalThis as Globals).React = React;
    ({ createRoot } = await import("react-dom/client"));
    ({ UploadForm } = await import("@/app/(admin)/admin/media/upload-form"));
    ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
    ({ UploadPreparationError } = await import("@/lib/media-upload"));
  });

  after(() => {
    for (const [key, value] of Object.entries(mountedReplaced)) (globalThis as Globals)[key] = value;
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function mount(options: {
    prepareFile: (file: File) => Promise<Prepared>;
    response?: { ok: boolean; status: number; json: () => Promise<unknown> };
  }) {
    const sent: FormData[] = [];
    let refreshed = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
      sent.push(init.body);
      return options.response ?? { ok: true, status: 201, json: async () => ({ id: "x" }) };
    }) as unknown as typeof fetch;
    const router = { refresh: () => { refreshed += 1; }, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
    const container = w.document.createElement("div");
    w.document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(AppRouterContext.Provider, { value: router as never }, createElement(UploadForm, { prepareFile: options.prepareFile })),
      );
    });
    const form = container.querySelector("form") as HTMLFormElement;
    return {
      sent,
      refreshed: () => refreshed,
      button: () => container.querySelector("button") as HTMLButtonElement,
      notice: () => container.querySelector("p[role]") as HTMLElement,
      async submit(wait = true) {
        await act(async () => {
          form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
          if (wait) await settle();
        });
      },
      async cleanup() {
        await act(async () => root.unmount());
        container.remove();
        globalThis.fetch = realFetch;
        selected = null;
      },
    };
  }

  it("uploads the prepared file, not the original, and refreshes the library", async () => {
    selected = jpeg("DSC_0001.JPG");
    const resized = jpeg("DSC_0001.jpg", 16);
    const prepared: File[] = [];
    const view = await mount({
      prepareFile: async (file) => {
        prepared.push(file);
        return { file: resized, resized: true };
      },
    });
    try {
      await view.submit();
      assert.equal(prepared.length, 1);
      assert.equal(prepared[0].name, "DSC_0001.JPG", "the selected file is what gets prepared");
      assert.equal(view.sent.length, 1);
      const uploaded = view.sent[0].get("file") as File;
      assert.equal(uploaded.name, "DSC_0001.jpg");
      assert.equal(uploaded.size, 16);
      assert.equal(view.notice().textContent, "Image uploaded successfully.");
      assert.equal(view.notice().getAttribute("role"), "status");
      assert.equal(view.refreshed(), 1);
      assert.equal(view.button().textContent, "Upload image");
    } finally {
      await view.cleanup();
    }
  });

  it("shows the preparation stage while the photo is being resized", async () => {
    selected = jpeg("big.jpg");
    let release: (value: Prepared) => void = () => {};
    const view = await mount({ prepareFile: () => new Promise<Prepared>((resolve) => { release = resolve; }) });
    try {
      await view.submit(false);
      assert.equal(view.button().textContent, "Preparing image…");
      assert.equal(view.button().disabled, true);
      assert.equal(view.sent.length, 0, "nothing is sent before preparation finishes");
      await act(async () => {
        release({ file: selected as File, resized: false });
        await settle();
      });
      assert.equal(view.sent.length, 1);
      assert.equal(view.button().textContent, "Upload image");
    } finally {
      await view.cleanup();
    }
  });

  it("reports a preparation failure as an alert and sends nothing", async () => {
    selected = jpeg("huge.jpg");
    const view = await mount({
      prepareFile: async () => {
        throw new UploadPreparationError("This image is still larger than 4.0 MB after resizing.");
      },
    });
    try {
      await view.submit();
      assert.equal(view.sent.length, 0);
      assert.equal(view.notice().getAttribute("role"), "alert");
      assert.equal(view.notice().textContent, "This image is still larger than 4.0 MB after resizing.");
      assert.equal(view.button().disabled, false, "the form is usable again");
    } finally {
      await view.cleanup();
    }
  });

  it("explains a platform 413 that carries no JSON message", async () => {
    selected = jpeg("photo.jpg");
    const view = await mount({
      prepareFile: async (file) => ({ file, resized: false }),
      response: {
        ok: false,
        status: 413,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      },
    });
    try {
      await view.submit();
      assert.equal(view.notice().getAttribute("role"), "alert");
      assert.match(view.notice().textContent ?? "", /too large for the server to accept/);
      assert.equal(view.refreshed(), 0);
    } finally {
      await view.cleanup();
    }
  });

  it("keeps the server's own message when it sends one", async () => {
    selected = jpeg("photo.jpg");
    const view = await mount({
      prepareFile: async (file) => ({ file, resized: false }),
      response: { ok: false, status: 400, json: async () => ({ message: "That image format is not supported." }) },
    });
    try {
      await view.submit();
      assert.equal(view.notice().textContent, "That image format is not supported.");
      assert.equal(view.notice().getAttribute("role"), "alert");
    } finally {
      await view.cleanup();
    }
  });
});
