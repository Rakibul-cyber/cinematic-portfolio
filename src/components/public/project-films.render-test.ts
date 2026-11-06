import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM, VirtualConsole } from "jsdom";

import type { PublicFilm } from "@/server/public/view-models";

/**
 * The public Films section (P3-11E): server HTML carries no playback data,
 * order is kept, and a playback URL is requested only after Play, for this
 * project. `fetch` and hls.js are fakes; nothing leaves the process.
 */

type Globals = Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://munir.example.test/work/harbour-light", virtualConsole: new VirtualConsole() });
const w = dom.window;
const replaced: Globals = {};
const requests: string[] = [];

let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let createRoot: typeof import("react-dom/client").createRoot;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let ProjectFilms: typeof import("@/components/public/project-films").ProjectFilms;

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYLIST = "https://stream.mux.com/SignedPlayback0001.m3u8?token=fictional.jwt.token";

const films: PublicFilm[] = [
  { videoId: "22222222-2222-4222-8222-222222222222", projectId: PROJECT_ID, title: "Main film", durationLabel: "4:05" },
  { videoId: "11111111-1111-4111-8111-111111111111", projectId: PROJECT_ID, title: "Behind the scenes", durationLabel: null },
];

before(async () => {
  const globals: Globals = {
    window: w,
    document: w.document,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    HTMLVideoElement: w.HTMLVideoElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ url: PLAYLIST, expiresAt: "2027-01-01T00:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    replaced[key] = (globalThis as Globals)[key];
    (globalThis as Globals)[key] = value;
  }
  // Safari-style native HLS, so no player library is loaded in this test.
  w.HTMLMediaElement.prototype.canPlayType = () => "maybe";
  w.HTMLMediaElement.prototype.play = async () => undefined;
  w.HTMLMediaElement.prototype.load = () => undefined;
  const React = await import("react");
  ({ act, createElement } = React);
  replaced.React = (globalThis as Globals).React;
  (globalThis as Globals).React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ ProjectFilms } = await import("@/components/public/project-films"));
});

after(() => {
  for (const [key, value] of Object.entries(replaced)) (globalThis as Globals)[key] = value;
  dom.window.close();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("public Films section", () => {
  it("server HTML holds titles and Play buttons only: no playback URL, token, or provider id", () => {
    const html = renderToStaticMarkup(createElement(ProjectFilms, { films, projectTitle: "Harbour Light" }));
    for (const leak of ["stream.mux.com", "token", "m3u8", "Playback", "<video", "<iframe", "/api/videos"]) {
      assert.equal(html.includes(leak), false, leak);
    }
    assert.match(html, /Films/);
    assert.equal(requests.length, 0);
  });

  it("renders nothing when the project has no films", () => {
    assert.equal(renderToStaticMarkup(createElement(ProjectFilms, { films: [], projectTitle: "Harbour Light" })), "");
  });

  it("keeps the saved order", () => {
    const host = w.document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(ProjectFilms, { films, projectTitle: "Harbour Light" }));
    assert.deepEqual([...host.querySelectorAll("[data-film]")].map((item) => item.getAttribute("data-film")), films.map((film) => film.videoId));
    assert.match(host.querySelector("[data-film]")?.textContent ?? "", /Main film\s*4:05/);
  });

  it("requests a playback URL only after Play, for this project, and only for that film", async () => {
    const host = w.document.createElement("div");
    w.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(ProjectFilms, { films, projectTitle: "Harbour Light" })));
    await settle();
    assert.equal(requests.length, 0, "nothing requested on load");
    assert.equal(host.querySelector("video"), null);

    const second = host.querySelectorAll<HTMLButtonElement>("[data-hls-player] button")[1];
    await act(async () => second.click());
    await act(async () => settle());
    assert.deepEqual(requests, [`/api/videos/${films[1].videoId}/playback?projectId=${PROJECT_ID}`]);
    const videos = host.querySelectorAll("video");
    assert.equal(videos.length, 1, "only the clicked film is loaded");
    assert.equal(videos[0].getAttribute("aria-label"), "Video: Behind the scenes");
    await act(async () => root.unmount());
    host.remove();
  });
});
