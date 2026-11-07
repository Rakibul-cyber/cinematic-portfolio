import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describeVideoUrl, ProjectVideoField } from "@/components/admin/project-video-field";

// The component's JSX compiles to the classic runtime outside Next.js.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const DRIVE = "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345/view";

describe("project video field", () => {
  it("detects the provider of a pasted link, or explains why it is refused", () => {
    assert.deepEqual(describeVideoUrl(""), { kind: "empty" });
    assert.deepEqual(describeVideoUrl(DRIVE), { kind: "ok", label: "Google Drive" });
    assert.deepEqual(describeVideoUrl("https://youtu.be/dQw4w9WgXcQ"), { kind: "ok", label: "YouTube" });
    assert.deepEqual(describeVideoUrl("https://vimeo.com/76979871"), { kind: "ok", label: "Vimeo" });
    assert.equal(describeVideoUrl("https://example.com/film.mp4").kind, "error");
  });

  it("submits the link as videoUrl and previews a saved video with the click-to-load player", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectVideoField, { initialUrl: DRIVE, savedTitle: "Brand film" }));
    assert.match(html, /name="videoUrl"/);
    assert.match(html, /<input type="hidden" name="videoTitle" value="Brand film"\/>/, "a saved title is kept unchanged");
    assert.ok(!/<input[^>]*type="text"[^>]*name="videoTitle"|<input[^>]*name="videoTitle"[^>]*type="text"/.test(html), "no visible title input");
    assert.match(html, /Detected: Google Drive/);
    assert.match(html, /Play Brand film/);
    assert.ok(!html.includes("<iframe"), "the preview loads nothing until pressed");
    assert.ok(!html.includes('name="videoProvider"') && !html.includes('name="videoId"'), "no raw provider or ID inputs");
  });

  it("shows no preview without a valid link", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectVideoField, { initialUrl: "", savedTitle: "" }));
    assert.ok(!html.includes("Play "));
    assert.ok(!/Video provider|Video ID/.test(html), "a link only: never a provider or video ID");
  });

  it("marks a refused link invalid, explains why and shows no preview", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectVideoField, { initialUrl: "https://example.com/film.mp4", savedTitle: "" }));
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /id="project-video-status"[^>]*>[^<]+</);
    assert.ok(!html.includes("Play "));
  });
});
