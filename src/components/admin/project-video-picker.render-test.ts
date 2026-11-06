import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM, VirtualConsole } from "jsdom";

import type { ProjectVideoOption } from "@/lib/cms/project-videos";

/**
 * The project editor's video section (P3-11E) in jsdom: what it submits
 * (marker, ids in order), which videos it offers, and that removal only drops
 * the id from the form.
 */

type Globals = Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://studio.example.test/admin/projects/p", virtualConsole: new VirtualConsole() });
const w = dom.window;
const replaced: Globals = {};

let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let ProjectVideoPicker: typeof import("@/components/admin/project-video-picker").ProjectVideoPicker;

before(async () => {
  const globals: Globals = {
    window: w,
    document: w.document,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    HTMLFormElement: w.HTMLFormElement,
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
  ({ ProjectVideoPicker } = await import("@/components/admin/project-video-picker"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

const option = (id: string, title: string, status: ProjectVideoOption["status"] = "READY"): ProjectVideoOption => ({
  id,
  title,
  status,
  durationSeconds: 90,
  width: 1920,
  height: 1080,
  maxResolution: "1080p",
});

const A = option("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Brand film");
const B = option("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Behind the scenes");
const C = option("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Teaser");

async function mount(initialVideoIds: string[], videos: ProjectVideoOption[]) {
  const form = w.document.createElement("form");
  w.document.body.append(form);
  const root = createRoot(form);
  await act(async () => root.render(createElement(ProjectVideoPicker, { initialVideoIds, videos })));
  const button = (selector: string) => {
    const element = form.querySelector<HTMLButtonElement>(selector);
    assert.ok(element, selector);
    return element;
  };
  return {
    form,
    submitted: () => {
      const data = new w.FormData(form);
      return { section: data.get("videoSection"), ids: data.getAll("videoIds") };
    },
    click: async (selector: string) => act(async () => button(selector).click()),
    button,
    unmount: async () => {
      await act(async () => root.unmount());
      form.remove();
    },
  };
}

describe("project video picker", () => {
  it("submits the section marker and the saved order", async () => {
    const view = await mount([B.id, A.id], [B, A, C]);
    assert.deepEqual(view.submitted(), { section: "1", ids: [B.id, A.id] });
    const rows = [...view.form.querySelectorAll("[data-video-row]")].map((row) => row.getAttribute("data-video-row"));
    assert.deepEqual(rows, [B.id, A.id]);
    await view.unmount();
  });

  it("submits the marker with no ids when nothing is selected, so the save clears assignments on purpose", async () => {
    const view = await mount([], [A]);
    assert.deepEqual(view.submitted(), { section: "1", ids: [] });
    assert.match(view.form.textContent ?? "", /No videos selected/);
    await view.unmount();
  });

  it("adds a READY video at the end", async () => {
    const view = await mount([A.id], [A, B]);
    await view.click(`[data-video-add="${B.id}"]`);
    assert.deepEqual(view.submitted().ids, [A.id, B.id]);
    await view.unmount();
  });

  it("offers only READY videos for adding", async () => {
    const processing = option("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Rough cut", "PROCESSING");
    const view = await mount([], [A, processing]);
    assert.ok(view.form.querySelector(`[data-video-add="${A.id}"]`));
    assert.equal(view.form.querySelector(`[data-video-add="${processing.id}"]`), null);
    await view.unmount();
  });

  it("removes a video from the project only: the id leaves the form and the video is offered again", async () => {
    const view = await mount([A.id, B.id], [A, B]);
    await view.click(`[data-video-remove="${A.id}"]`);
    assert.deepEqual(view.submitted().ids, [B.id]);
    assert.ok(view.form.querySelector(`[data-video-add="${A.id}"]`), "still in the library");
    assert.match(view.form.textContent ?? "", /stays in the video library/);
    await view.unmount();
  });

  it("reorders with Up and Down, with the ends disabled", async () => {
    const view = await mount([A.id, B.id, C.id], [A, B, C]);
    assert.equal(view.button(`[data-video-up="${A.id}"]`).disabled, true);
    assert.equal(view.button(`[data-video-down="${C.id}"]`).disabled, true);
    await view.click(`[data-video-down="${A.id}"]`);
    assert.deepEqual(view.submitted().ids, [B.id, A.id, C.id]);
    await view.click(`[data-video-up="${C.id}"]`);
    assert.deepEqual(view.submitted().ids, [B.id, C.id, A.id]);
    assert.match(view.form.textContent ?? "", /Teaser moved to position 2 of 3/);
    await view.unmount();
  });

  it("flags an attached video that is not READY so it can be removed before saving", async () => {
    const failed = option("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Broken", "FAILED");
    const view = await mount([failed.id], [failed, A]);
    assert.match(view.form.querySelector(`[data-video-row="${failed.id}"]`)?.textContent ?? "", /Not ready\. Remove it before saving\./);
    await view.unmount();
  });

  it("renders no provider identifier", async () => {
    const view = await mount([A.id], [A, B]);
    const html = view.form.innerHTML;
    for (const leak of ["mux", "playback", "token", "m3u8"]) assert.equal(html.toLowerCase().includes(leak), false, leak);
    await view.unmount();
  });
});
