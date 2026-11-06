import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM, VirtualConsole } from "jsdom";

import type { AdminVideoView } from "@/lib/video-library";

/**
 * The mounted admin video library and the click-to-load player (P3-11D) in
 * jsdom. Network, UpChunk, hls.js, and confirmation are injected fakes; no
 * request leaves the process and no real credential exists here.
 */

type Globals = Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://studio.example.test/admin/videos", virtualConsole: new VirtualConsole() });
const w = dom.window;
const replaced: Globals = {};
let selected: File | null = null;

let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let VideoLibrary: typeof import("@/app/(admin)/admin/videos/video-library").VideoLibrary;
let HlsPlayer: typeof import("@/components/video/hls-player").HlsPlayer;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;

const PLAYLIST = "https://stream.mux.com/SignedPlayback0001.m3u8?token=fictional.jwt.token";
const UPLOAD_ORIGIN = "https://uploads.example.test";

before(async () => {
  class SelectedFormData extends w.FormData {
    constructor(form?: HTMLFormElement) {
      super(form);
      if (selected) this.set("file", selected, selected.name);
    }
  }
  const globals: Globals = {
    window: w,
    document: w.document,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    HTMLInputElement: w.HTMLInputElement,
    HTMLButtonElement: w.HTMLButtonElement,
    HTMLFormElement: w.HTMLFormElement,
    HTMLVideoElement: w.HTMLVideoElement,
    File: w.File,
    Blob: w.Blob,
    FormData: SelectedFormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  w.HTMLMediaElement.prototype.play = async () => undefined;
  w.HTMLMediaElement.prototype.load = () => undefined;
  const React = await import("react");
  ({ act, createElement } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ VideoLibrary } = await import("@/app/(admin)/admin/videos/video-library"));
  ({ HlsPlayer } = await import("@/components/video/hls-player"));
  ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function video(overrides: Partial<AdminVideoView> = {}): AdminVideoView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Brand film",
    originalFilename: "brand.mov",
    status: "READY",
    durationSeconds: 65,
    width: 3840,
    height: 2160,
    maxResolution: "2160p",
    failureCode: null,
    assignmentCount: 0,
    createdAt: "2027-02-01T12:00:00.000Z",
    ...overrides,
  };
}

type Call = { url: string; init?: RequestInit };
type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A recording fetch; unmatched requests fail the test loudly. */
function recorder(respond: Responder) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

class FakeHls {
  static instances: FakeHls[] = [];
  static supported = true;
  static Events = { ERROR: "hlsError" };
  static isSupported() {
    return FakeHls.supported;
  }
  source: string | null = null;
  media: unknown = null;
  destroyed = false;
  listeners = new Map<string, (event: string, data: { fatal?: boolean }) => void>();
  constructor(readonly config: { enableWorker: boolean }) {
    FakeHls.instances.push(this);
  }
  loadSource(url: string) {
    this.source = url;
  }
  attachMedia(media: unknown) {
    this.media = media;
  }
  on(event: string, listener: (event: string, data: { fatal?: boolean }) => void) {
    this.listeners.set(event, listener);
  }
  destroy() {
    this.destroyed = true;
  }
}

async function render(element: ReturnType<typeof createElement>) {
  let refreshed = 0;
  const router = { refresh: () => (refreshed += 1), push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
  const container = w.document.createElement("div");
  w.document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AppRouterContext.Provider, { value: router as never }, element));
  });
  const buttons = () => [...container.querySelectorAll("button")] as HTMLButtonElement[];
  return {
    container,
    refreshed: () => refreshed,
    text: () => container.textContent ?? "",
    button: (label: RegExp) => buttons().find((button) => label.test(button.textContent ?? "")),
    async click(button: HTMLButtonElement | undefined) {
      assert.ok(button, "button exists");
      await act(async () => {
        button.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        await settle();
      });
    },
    async flush() {
      await act(async () => {
        await settle();
      });
    },
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
      selected = null;
    },
  };
}

const library = (videos: AdminVideoView[], deps: Record<string, unknown>, uploadOrigin: string | null = null, uploadsUnavailableMessage: string | null = "Video uploads are switched off until the upload host is confirmed for this site.") =>
  createElement(VideoLibrary, { videos, uploadOrigin, uploadsUnavailableMessage, deps: { pollMs: 60_000, ...deps } });

// ------------------------------------------------------------------ library rows

describe("video library rows", () => {
  it("shows title, status, duration, and resolution, and explains processing and failures", async () => {
    const view = await render(
      library(
        [
          video(),
          video({ id: "22222222-2222-4222-8222-222222222222", title: "Teaser", status: "PROCESSING", durationSeconds: null, width: null, height: null }),
          video({ id: "33333333-3333-4333-8333-333333333333", title: "Broken", status: "FAILED", failureCode: "input_unsupported" }),
        ],
        { fetchImpl: recorder(() => assert.fail("no request")).fetchImpl },
      ),
    );
    try {
      const text = view.text();
      assert.match(text, /Brand film/);
      assert.match(text, /Ready/);
      assert.match(text, /1:05/);
      assert.match(text, /3840 × 2160 \(2160p\)/);
      assert.match(text, /Processing/);
      assert.match(text, /Mux is preparing the video/);
      assert.match(text, /Export it as H\.264 or HEVC/);
      assert.equal(view.container.querySelectorAll("[data-video-row]").length, 3);
    } finally {
      await view.cleanup();
    }
  });

  it("refreshes while a video is processing and stops once everything has settled", async () => {
    const processing = await render(createElement(VideoLibrary, { videos: [video({ status: "PROCESSING" })], uploadOrigin: null, uploadsUnavailableMessage: "off", deps: { pollMs: 5 } }));
    const settled = await render(createElement(VideoLibrary, { videos: [video()], uploadOrigin: null, uploadsUnavailableMessage: "off", deps: { pollMs: 5 } }));
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      assert.ok(processing.refreshed() >= 2, "polls while processing");
      assert.equal(settled.refreshed(), 0, "no polling when nothing is in flight");
    } finally {
      await processing.cleanup();
      await settled.cleanup();
    }
  });
});

// ------------------------------------------------------------------ deletion

describe("video deletion", () => {
  it("asks for confirmation naming the video, and sends nothing when declined", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ deleted: true }));
    const prompts: string[] = [];
    const view = await render(library([video()], { fetchImpl, confirm: (message: string) => (prompts.push(message), false) }));
    try {
      await view.click(view.button(/^Delete/));
      assert.equal(prompts.length, 1);
      assert.match(prompts[0]!, /Permanently delete “Brand film”/);
      assert.equal(calls.length, 0);
    } finally {
      await view.cleanup();
    }
  });

  it("deletes after confirmation through DELETE /api/videos/[id] and refreshes", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ deleted: true }));
    const view = await render(library([video()], { fetchImpl, confirm: () => true }));
    try {
      await view.click(view.button(/^Delete/));
      assert.deepEqual(calls.map((call) => [call.url, call.init?.method, call.init?.credentials]), [["/api/videos/11111111-1111-4111-8111-111111111111", "DELETE", "same-origin"]]);
      assert.match(view.text(), /Video deleted\./);
      assert.equal(view.refreshed(), 1);
    } finally {
      await view.cleanup();
    }
  });

  it("offers no Delete for a video used by a project and says why", async () => {
    const view = await render(library([video({ assignmentCount: 1 })], { fetchImpl: recorder(() => assert.fail("no request")).fetchImpl }));
    try {
      assert.equal(view.button(/^Delete/), undefined);
      assert.match(view.text(), /This video is used by a project\. Remove it from every project before deleting it\./);
      assert.ok(view.button(/^Preview/), "still previewable");
    } finally {
      await view.cleanup();
    }
  });

  it("shows the server's refusal when the video became assigned in the meantime", async () => {
    const { fetchImpl } = recorder(() =>
      Response.json({ error: "delete_assigned", message: "This video is used by a project. Remove it from every project before deleting it." }, { status: 409 }),
    );
    const view = await render(library([video()], { fetchImpl, confirm: () => true }));
    try {
      await view.click(view.button(/^Delete/));
      const alert = view.container.querySelector("[data-video-row] p[role='alert']");
      assert.match(alert?.textContent ?? "", /used by a project/);
    } finally {
      await view.cleanup();
    }
  });

  it("reports a provider deletion failure as an alert, and a DELETE_FAILED video offers Retry delete", async () => {
    const failing = recorder(() => Response.json({ error: "delete_failed", message: "The video could not be deleted. Try again in a moment." }, { status: 503 }));
    const first = await render(library([video()], { fetchImpl: failing.fetchImpl, confirm: () => true }));
    try {
      await first.click(first.button(/^Delete/));
      assert.equal(first.container.querySelector("[data-video-row] p[role='alert']")?.textContent, "The video could not be deleted. Try again in a moment.");
      assert.equal(first.refreshed(), 1, "refreshes to show DELETE_FAILED");
    } finally {
      await first.cleanup();
    }

    const retrying = recorder(() => Response.json({ deleted: true }));
    const prompts: string[] = [];
    const second = await render(library([video({ status: "DELETE_FAILED" })], { fetchImpl: retrying.fetchImpl, confirm: (message: string) => (prompts.push(message), true) }));
    try {
      assert.match(second.text(), /Delete failed/);
      assert.match(second.text(), /could not be deleted/);
      const retry = second.button(/^Retry delete/);
      assert.ok(retry);
      await second.click(retry);
      assert.equal(prompts.length, 1, "retry still confirms");
      assert.equal(retrying.calls[0]!.init?.method, "DELETE");
      assert.match(second.text(), /Video deleted\./);
    } finally {
      await second.cleanup();
    }
  });

  it("uses a fixed message when the network fails, never raw text", async () => {
    const { fetchImpl } = recorder(() => new Response("<html>upstream detail</html>", { status: 502 }));
    const view = await render(library([video()], { fetchImpl, confirm: () => true }));
    try {
      await view.click(view.button(/^Delete/));
      assert.equal(view.text().includes("upstream detail"), false);
      assert.match(view.text(), /could not be deleted/);
    } finally {
      await view.cleanup();
    }
  });

  it("offers Cancel upload, not Delete, for an upload in progress", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ status: "CANCELLED" }));
    const view = await render(library([video({ status: "UPLOAD_PENDING", durationSeconds: null, width: null, height: null })], { fetchImpl }));
    try {
      assert.equal(view.button(/^Delete/), undefined);
      await view.click(view.button(/^Cancel upload/));
      assert.deepEqual(calls.map((call) => [call.url, call.init?.method]), [["/api/videos/uploads/11111111-1111-4111-8111-111111111111/cancel", "POST"]]);
      assert.match(view.text(), /The upload was cancelled\./);
    } finally {
      await view.cleanup();
    }
  });
});

// ------------------------------------------------------------------ preview and playback

describe("preview playback", () => {
  it("requests no playback token until Play is pressed, then plays through hls.js without a worker", async () => {
    FakeHls.instances = [];
    FakeHls.supported = true;
    w.HTMLMediaElement.prototype.canPlayType = () => "";
    const { calls, fetchImpl } = recorder(() => Response.json({ url: PLAYLIST, expiresAt: "2027-02-01T12:15:00.000Z" }));
    let hlsLoads = 0;
    const view = await render(library([video()], { fetchImpl, loadHls: async () => ((hlsLoads += 1), FakeHls) }));
    try {
      await view.click(view.button(/^Preview/));
      assert.equal(calls.length, 0, "opening the preview requests nothing");
      assert.equal(hlsLoads, 0, "the player library is not loaded yet");
      await view.click(view.button(/^Play/));
      await view.flush();
      assert.deepEqual(calls.map((call) => [call.url, call.init?.credentials, call.init?.cache]), [["/api/videos/11111111-1111-4111-8111-111111111111/playback", "same-origin", "no-store"]]);
      assert.equal(hlsLoads, 1);
      assert.equal(FakeHls.instances.length, 1);
      assert.equal(FakeHls.instances[0]!.config.enableWorker, false);
      assert.equal(FakeHls.instances[0]!.source, PLAYLIST);
      assert.ok(FakeHls.instances[0]!.media instanceof w.HTMLVideoElement);
    } finally {
      await view.cleanup();
    }
    assert.equal(FakeHls.instances[0]!.destroyed, true, "released on unmount");
  });

  it("uses native HLS where the browser supports it (Safari) and never loads hls.js", async () => {
    w.HTMLMediaElement.prototype.canPlayType = (type: string) => (type === "application/vnd.apple.mpegurl" ? "maybe" : "");
    const { fetchImpl } = recorder(() => Response.json({ url: PLAYLIST }));
    let hlsLoads = 0;
    const view = await render(createElement(HlsPlayer, { videoId: video().id, title: "Brand film", fetchImpl, loadHls: async () => ((hlsLoads += 1), FakeHls) }));
    try {
      await view.click(view.button(/^Play/));
      await view.flush();
      const element = view.container.querySelector("video") as HTMLVideoElement;
      assert.equal(element.getAttribute("src"), PLAYLIST);
      assert.equal(hlsLoads, 0);
    } finally {
      await view.cleanup();
      w.HTMLMediaElement.prototype.canPlayType = () => "";
    }
  });

  it("explains an unsupported browser and a fatal stream error", async () => {
    FakeHls.instances = [];
    FakeHls.supported = false;
    const { fetchImpl } = recorder(() => Response.json({ url: PLAYLIST }));
    const unsupported = await render(createElement(HlsPlayer, { videoId: video().id, title: "Brand film", fetchImpl, loadHls: async () => FakeHls }));
    try {
      await unsupported.click(unsupported.button(/^Play/));
      await unsupported.flush();
      assert.match(unsupported.container.querySelector("[role='alert']")?.textContent ?? "", /cannot play this video/);
    } finally {
      await unsupported.cleanup();
    }
    FakeHls.supported = true;
    const failing = await render(createElement(HlsPlayer, { videoId: video().id, title: "Brand film", fetchImpl, loadHls: async () => FakeHls }));
    try {
      await failing.click(failing.button(/^Play/));
      await failing.flush();
      await act(async () => FakeHls.instances.at(-1)!.listeners.get("hlsError")!("hlsError", { fatal: true }));
      assert.match(failing.container.querySelector("[role='alert']")?.textContent ?? "", /could not be loaded/);
      assert.ok(failing.button(/^Play/), "the viewer can try again");
    } finally {
      await failing.cleanup();
    }
  });

  it("refuses a playback URL that is not a signed playlist on the playback origin", async () => {
    FakeHls.instances = [];
    const { fetchImpl } = recorder(() => Response.json({ url: "https://evil.example/x.m3u8" }));
    const view = await render(createElement(HlsPlayer, { videoId: video().id, title: "Brand film", fetchImpl, loadHls: async () => FakeHls }));
    try {
      await view.click(view.button(/^Play/));
      assert.equal(view.container.querySelector("video"), null);
      assert.equal(FakeHls.instances.length, 0);
      assert.match(view.container.querySelector("[role='alert']")?.textContent ?? "", /could not be loaded/);
    } finally {
      await view.cleanup();
    }
  });
});

describe("public playback through the player", () => {
  it("asks for the project's playback and shows not-available for a draft or unpublished project", async () => {
    FakeHls.instances = [];
    const { calls, fetchImpl } = recorder(() => Response.json({ error: "not_found", message: "Video not found." }, { status: 404 }));
    const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const view = await render(createElement(HlsPlayer, { videoId: video().id, title: "Brand film", projectId, fetchImpl, loadHls: async () => FakeHls }));
    try {
      assert.equal(calls.length, 0, "nothing before Play");
      await view.click(view.button(/^Play/));
      assert.equal(calls[0]!.url, `/api/videos/11111111-1111-4111-8111-111111111111/playback?projectId=${projectId}`);
      assert.match(view.container.querySelector("[role='alert']")?.textContent ?? "", /not available/);
      assert.equal(view.container.querySelector("video"), null);
      assert.equal(FakeHls.instances.length, 0);
    } finally {
      await view.cleanup();
    }
  });
});

// ------------------------------------------------------------------ upload

describe("video upload form", () => {
  it("explains why uploads are off and offers no file input", async () => {
    const view = await render(library([], {}));
    try {
      assert.match(view.text(), /switched off until the upload host is confirmed/);
      assert.equal(view.container.querySelector("input[type='file']"), null);
      assert.match(view.text(), /No videos uploaded yet\./);
    } finally {
      await view.cleanup();
    }
  });

  function chunkFake() {
    const listeners = new Map<string, (event: { detail?: unknown }) => void>();
    const state = { aborted: false, endpoint: "" };
    const create = (options: { endpoint: string }) => {
      state.endpoint = options.endpoint;
      return {
        on: (event: string, listener: (event: { detail?: unknown }) => void) => listeners.set(event, listener),
        abort: () => {
          state.aborted = true;
        },
      };
    };
    return { listeners, state, create };
  }

  async function startUpload(view: Awaited<ReturnType<typeof render>>) {
    selected = new w.File([new Uint8Array(64)], "reel.mp4", { type: "video/mp4" }) as unknown as File;
    (view.container.querySelector("input[name='title']") as HTMLInputElement).value = "Showreel";
    const form = view.container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
      await settle();
      await settle();
    });
  }

  it("shows chunked upload progress and a success message, then refreshes", async () => {
    const chunk = chunkFake();
    const { calls, fetchImpl } = recorder((url) =>
      url === "/api/videos/uploads" ? Response.json({ videoId: video().id, uploadUrl: `${UPLOAD_ORIGIN}/u?sig=fictional`, expiresAt: "x" }, { status: 201 }) : assert.fail(url),
    );
    const view = await render(library([], { fetchImpl, loadChunkUploader: async () => chunk.create }, UPLOAD_ORIGIN, null));
    try {
      await startUpload(view);
      assert.equal(calls.length, 1);
      assert.equal(chunk.state.endpoint, `${UPLOAD_ORIGIN}/u?sig=fictional`);
      await act(async () => chunk.listeners.get("progress")!({ detail: 42.7 }));
      const progress = view.container.querySelector("progress") as HTMLProgressElement;
      assert.equal(progress.getAttribute("value"), "42.7");
      assert.match(view.text(), /Uploading… 42%/);
      assert.equal(view.text().includes("sig=fictional"), false, "the upload URL is never shown");
      await act(async () => {
        chunk.listeners.get("success")!({});
        await settle();
      });
      assert.match(view.text(), /Upload complete\. Mux is processing the video/);
      assert.equal(view.container.querySelector("progress"), null);
      assert.ok(view.refreshed() >= 1);
    } finally {
      await view.cleanup();
    }
  });

  it("cancels an upload in progress: aborts the transfer and cancels the provider upload", async () => {
    const chunk = chunkFake();
    const { calls, fetchImpl } = recorder((url) =>
      url === "/api/videos/uploads"
        ? Response.json({ videoId: video().id, uploadUrl: `${UPLOAD_ORIGIN}/u?sig=fictional` }, { status: 201 })
        : Response.json({ status: "CANCELLED" }),
    );
    const view = await render(library([], { fetchImpl, loadChunkUploader: async () => chunk.create }, UPLOAD_ORIGIN, null));
    try {
      await startUpload(view);
      await act(async () => chunk.listeners.get("progress")!({ detail: 10 }));
      await view.click(view.button(/^Cancel upload/));
      await view.flush();
      assert.equal(chunk.state.aborted, true);
      assert.deepEqual(calls.map((call) => call.url), ["/api/videos/uploads", `/api/videos/uploads/${video().id}/cancel`]);
      assert.match(view.text(), /The upload was cancelled\./);
      assert.ok(view.button(/^Upload video/), "the form is ready again");
    } finally {
      await view.cleanup();
    }
  });

  it("shows a clear error when the transfer fails", async () => {
    const chunk = chunkFake();
    const { fetchImpl } = recorder(() => Response.json({ videoId: video().id, uploadUrl: `${UPLOAD_ORIGIN}/u` }, { status: 201 }));
    const view = await render(library([], { fetchImpl, loadChunkUploader: async () => chunk.create }, UPLOAD_ORIGIN, null));
    try {
      await startUpload(view);
      await act(async () => {
        chunk.listeners.get("error")!({ detail: { message: "provider internals" } });
        await settle();
      });
      const alert = view.container.querySelector("form p[role='alert']");
      assert.match(alert?.textContent ?? "", /The upload was interrupted/);
      assert.equal(view.text().includes("provider internals"), false);
    } finally {
      await view.cleanup();
    }
  });
});
