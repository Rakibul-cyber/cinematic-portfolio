import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import type { ProjectMediaOption } from "@/lib/cms/project-media";

/**
 * The mounted project media picker (MH-14): an editor can upload images from
 * the project form, add them from the library, see thumbnails, choose the
 * cover, reorder, and remove. The canvas codec is replaced through the
 * `prepareFile` prop because jsdom has no image decoding.
 */
describe("the project media picker", () => {
  type Globals = Record<string, unknown>;
  type Prepared = { file: File; resized: boolean };
  type Response = { ok: boolean; status: number; json: () => Promise<unknown> };
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const w = dom.window;
  const replaced: Globals = {};
  let act: typeof import("react").act;
  let createElement: typeof import("react").createElement;
  let createRoot: typeof import("react-dom/client").createRoot;
  let ProjectMediaPicker: typeof import("@/components/admin/project-media-picker").ProjectMediaPicker;
  let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
  let UploadPreparationError: typeof import("@/lib/media-upload").UploadPreparationError;

  const jpeg = (name: string, bytes = 64) => new w.File([new Uint8Array(bytes)], name, { type: "image/jpeg" }) as unknown as File;
  const option = (id: string): ProjectMediaOption => ({
    id,
    originalName: `${id}.jpg`,
    altText: null,
    thumbnailUrl: `https://cdn.example/${id}/thumbnail.webp`,
  });

  before(async () => {
    const globals: Globals = {
      window: w,
      document: w.document,
      Node: w.Node,
      Element: w.Element,
      HTMLElement: w.HTMLElement,
      HTMLFormElement: w.HTMLFormElement,
      HTMLInputElement: w.HTMLInputElement,
      HTMLButtonElement: w.HTMLButtonElement,
      File: w.File,
      Blob: w.Blob,
      FormData: w.FormData,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const [key, value] of Object.entries(globals)) {
      replaced[key] = (globalThis as Globals)[key];
      (globalThis as Globals)[key] = value;
    }
    const React = await import("react");
    ({ act, createElement } = React);
    replaced.React = (globalThis as Globals).React;
    (globalThis as Globals).React = React;
    ({ createRoot } = await import("react-dom/client"));
    ({ ProjectMediaPicker } = await import("@/components/admin/project-media-picker"));
    ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
    ({ UploadPreparationError } = await import("@/lib/media-upload"));
  });

  after(() => {
    for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
    w.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function mount(options: {
    initialMediaIds?: string[];
    media?: ProjectMediaOption[];
    prepareFile?: (file: File) => Promise<Prepared>;
    respond?: (call: number) => Response;
  } = {}) {
    const sent: FormData[] = [];
    let refreshed = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
      sent.push(init.body);
      return options.respond?.(sent.length) ?? { ok: true, status: 201, json: async () => ({ id: `uploaded-${sent.length}` }) };
    }) as unknown as typeof fetch;
    const router = { refresh: () => { refreshed += 1; }, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
    const container = w.document.createElement("div");
    w.document.body.append(container);
    const root = createRoot(container);
    const render = (media: ProjectMediaOption[]) =>
      act(async () => {
        root.render(
          createElement(
            AppRouterContext.Provider,
            { value: router as never },
            // The form stands in for the project form the picker lives in.
            createElement(
              "form",
              null,
              createElement(ProjectMediaPicker, {
                initialMediaIds: options.initialMediaIds ?? [],
                media,
                prepareFile: options.prepareFile ?? (async (file: File) => ({ file, resized: false })),
              }),
            ),
          ),
        );
      });
    await render(options.media ?? []);
    const one = <T extends Element>(selector: string) => container.querySelector(selector) as T | null;
    return {
      sent,
      render,
      refreshed: () => refreshed,
      one,
      ids: () => Array.from(container.querySelectorAll<HTMLInputElement>('input[name="mediaIds"]')).map((input) => input.value),
      submitted: () => new w.FormData(one<HTMLFormElement>("form") as HTMLFormElement).getAll("mediaIds"),
      notice: () => one<HTMLElement>("[data-upload-notice]") as HTMLElement,
      text: () => container.textContent ?? "",
      async click(selector: string) {
        const button = one<HTMLButtonElement>(selector);
        assert.ok(button, `control ${selector}`);
        await act(async () => button.click());
      },
      async choose(files: File[], wait = true) {
        const input = one<HTMLInputElement>("input[data-upload]") as HTMLInputElement;
        Object.defineProperty(input, "files", { configurable: true, value: files });
        await act(async () => {
          input.dispatchEvent(new w.Event("change", { bubbles: true }));
          if (wait) await settle();
        });
      },
      async cleanup() {
        await act(async () => root.unmount());
        container.remove();
        globalThis.fetch = realFetch;
      },
    };
  }

  it("offers an upload control even when the media library is empty", async () => {
    const view = await mount();
    try {
      const input = view.one<HTMLInputElement>("input[data-upload]");
      assert.ok(input, "an upload control is visible");
      assert.equal(input.type, "file");
      assert.equal(input.multiple, true);
      assert.equal(input.accept, "image/jpeg,image/png,image/webp");
      assert.equal(input.hasAttribute("name"), false, "the file is never submitted with the project form");
      assert.match(view.text(), /No images yet\. Upload one above\./);
      assert.equal(view.one("[data-add]"), null);
      assert.equal(view.one('a[href="/admin/media"]')?.getAttribute("target"), "_blank");
    } finally {
      await view.cleanup();
    }
  });

  it("shows library images as thumbnails and adds them in order", async () => {
    const view = await mount({ media: [option("a"), option("b")] });
    try {
      assert.equal(view.one<HTMLImageElement>("ul img")?.getAttribute("src"), "https://cdn.example/a/thumbnail.webp");
      await view.click('[data-add="a"]');
      await view.click('[data-add="b"]');
      assert.deepEqual(view.ids(), ["a", "b"]);
      assert.deepEqual(view.submitted(), ["a", "b"], "the project form submits the images in order");
      const thumbnails = Array.from(view.one("ol")?.querySelectorAll("img") ?? []).map((img) => img.getAttribute("src"));
      assert.deepEqual(thumbnails, ["https://cdn.example/a/thumbnail.webp", "https://cdn.example/b/thumbnail.webp"]);
      assert.match(view.one("ol li")?.textContent ?? "", /1\. a\.jpg.*Cover image/);
      assert.equal(view.one("[data-add]"), null, "an attached image is no longer offered");
    } finally {
      await view.cleanup();
    }
  });

  it("chooses the cover, reorders, and removes without deleting", async () => {
    const view = await mount({ initialMediaIds: ["a", "b", "c"], media: [option("a"), option("b"), option("c")] });
    try {
      assert.equal(view.one('[data-cover="a"]'), null, "the cover has no Make cover button");
      await view.click('[data-cover="c"]');
      assert.deepEqual(view.ids(), ["c", "a", "b"]);
      assert.equal(w.document.activeElement, view.one('[data-down="c"]'), "focus stays on the moved image");
      await view.click('[data-down="a"]');
      assert.deepEqual(view.ids(), ["c", "b", "a"]);
      await view.click('[data-remove="b"]');
      assert.deepEqual(view.ids(), ["c", "a"]);
      assert.ok(view.one('[data-add="b"]'), "a removed image stays in the library and can be added again");
      assert.equal(view.sent.length, 0, "removing sends no request");
    } finally {
      await view.cleanup();
    }
  });

  it("uploads the prepared files, attaches them, and reloads the library", async () => {
    const prepared: string[] = [];
    const view = await mount({
      initialMediaIds: ["a"],
      media: [option("a")],
      prepareFile: async (file) => {
        prepared.push(file.name);
        return { file: jpeg(file.name.toLowerCase(), 16), resized: true };
      },
    });
    try {
      await view.choose([jpeg("ONE.JPG"), jpeg("TWO.JPG")]);
      assert.deepEqual(prepared, ["ONE.JPG", "TWO.JPG"]);
      assert.equal(view.sent.length, 2);
      const first = view.sent[0].get("file") as File;
      assert.equal(first.name, "one.jpg", "the prepared file is what is sent");
      assert.equal(first.size, 16);
      assert.deepEqual(view.ids(), ["a", "uploaded-1", "uploaded-2"], "uploads are appended after existing images");
      assert.equal(view.refreshed(), 1);
      assert.equal(view.notice().getAttribute("role"), "status");
      assert.equal(view.notice().textContent, "2 images added. Save the project to keep them.");
      assert.match(view.text(), /2\. ONE\.JPG/, "an upload is listed by name before its thumbnail arrives");
      assert.equal(view.one<HTMLInputElement>("input[data-upload]")?.disabled, false);

      // The refreshed page supplies the library rows, with thumbnails.
      await view.render([option("uploaded-2"), option("uploaded-1"), option("a")]);
      assert.deepEqual(view.ids(), ["a", "uploaded-1", "uploaded-2"], "the editor's order survives the refresh");
      assert.equal(view.one("ol")?.querySelectorAll("img").length, 3);
    } finally {
      await view.cleanup();
    }
  });

  it("disables the control and shows progress while uploading", async () => {
    let release: (value: Prepared) => void = () => {};
    const view = await mount({ prepareFile: () => new Promise<Prepared>((resolve) => { release = resolve; }) });
    try {
      await view.choose([jpeg("big.jpg")], false);
      assert.equal(view.notice().textContent, "Uploading image…");
      assert.equal(view.one<HTMLInputElement>("input[data-upload]")?.disabled, true);
      assert.equal(view.sent.length, 0, "nothing is sent before preparation finishes");
      await act(async () => {
        release({ file: jpeg("big.jpg"), resized: false });
        await settle();
      });
      assert.deepEqual(view.ids(), ["uploaded-1"]);
    } finally {
      await view.cleanup();
    }
  });

  it("reports a refused upload as an alert and attaches nothing", async () => {
    const view = await mount({
      respond: () => ({ ok: false, status: 400, json: async () => ({ message: "That image format is not supported." }) }),
    });
    try {
      await view.choose([jpeg("photo.jpg")]);
      assert.equal(view.notice().getAttribute("role"), "alert");
      assert.equal(view.notice().textContent, "photo.jpg: That image format is not supported.");
      assert.deepEqual(view.ids(), []);
      assert.equal(view.refreshed(), 0);
    } finally {
      await view.cleanup();
    }
  });

  it("keeps the images that uploaded when another one fails", async () => {
    const view = await mount({
      prepareFile: async (file) => {
        if (file.name === "huge.jpg") throw new UploadPreparationError("This image is still larger than 4.0 MB after resizing.");
        return { file, resized: false };
      },
      respond: (call) =>
        call === 1
          ? { ok: true, status: 201, json: async () => ({ id: "kept" }) }
          : { ok: false, status: 413, json: async () => { throw new SyntaxError("Unexpected token <"); } },
    });
    try {
      await view.choose([jpeg("good.jpg"), jpeg("huge.jpg"), jpeg("big.jpg")]);
      assert.deepEqual(view.ids(), ["kept"]);
      assert.equal(view.sent.length, 2, "the image that failed preparation is never sent");
      assert.equal(view.refreshed(), 1);
      assert.equal(view.notice().getAttribute("role"), "alert");
      assert.match(view.notice().textContent ?? "", /^1 image added\. Save the project to keep it\./);
      assert.match(view.notice().textContent ?? "", /huge\.jpg: This image is still larger than 4\.0 MB after resizing\./);
      assert.match(view.notice().textContent ?? "", /big\.jpg: The image is too large for the server to accept/);
    } finally {
      await view.cleanup();
    }
  });
});
