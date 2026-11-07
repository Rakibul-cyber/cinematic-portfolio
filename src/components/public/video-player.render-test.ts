import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  shouldMoveFocusOnActivate,
  VideoPlayer,
  videoPlayerName,
  VideoPlayerView,
} from "@/components/public/video-player";

/**
 * Phase 10D-2A: pressing Play removes the button that held keyboard focus.
 *
 * Both states are rendered through the stateless view, so the activated
 * markup is checked without a browser. The click itself, and the effect that
 * focuses the container, still need a browser.
 */

// See turnstile-widget.render-test.ts: the component's JSX compiles to the
// classic runtime outside Next.js and needs `React` as a global.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const EMBED = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1";

const view = (isActivated: boolean) =>
  renderToStaticMarkup(
    React.createElement(VideoPlayerView, {
      embedUrl: EMBED,
      isActivated,
      label: "Showreel",
      onActivate: () => {},
    }),
  );

describe("video player before activation", () => {
  it("renders a button and contacts no provider", () => {
    const html = renderToStaticMarkup(
      React.createElement(VideoPlayer, {
        fallbackLabel: "Showreel",
        video: { provider: "YOUTUBE", videoId: "dQw4w9WgXcQ", title: null },
      }),
    );
    assert.match(html, /<button[^>]*type="button"/);
    assert.ok(!html.includes("<iframe"), "no iframe until the visitor presses play");
    assert.ok(!html.includes("youtube"), "no provider URL in the initial markup");
  });

  it("keeps the container out of the tab order and unnamed, so the button's label is not doubled", () => {
    const container = /^<div[^>]*>/.exec(view(false))?.[0] ?? "";
    assert.doesNotMatch(container, /tabindex|role=|aria-label/i);
  });
});

describe("video player after activation", () => {
  it("makes the container a programmatic focus target that is never a Tab stop", () => {
    assert.match(view(true), /^<div[^>]*tabindex="-1"/i);
  });

  it("names the focused container as the player, without repeating the iframe's title verbatim", () => {
    const html = view(true);
    const container = /^<div[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(container, /role="group"/);
    assert.match(container, /aria-label="Video player: Showreel"/);
    assert.equal(videoPlayerName("Showreel"), "Video player: Showreel");
    const iframeTitle = /<iframe[^>]*title="([^"]*)"/.exec(html)?.[1];
    assert.notEqual(iframeTitle, videoPlayerName("Showreel"), "the group and the frame announce different names");
  });

  it("leaves the named iframe in the normal tab order", () => {
    const iframe = /<iframe[^>]*>/.exec(view(true))?.[0] ?? "";
    assert.match(iframe, /title="Showreel"/);
    assert.doesNotMatch(iframe, /tabindex/i, "the next Tab must reach the player");
  });

  it("attaches no load handler that could move focus into the iframe", () => {
    const element = VideoPlayerView({
      embedUrl: EMBED,
      isActivated: true,
      label: "Showreel",
      onActivate: () => {},
    }) as React.ReactElement<{ children: React.ReactElement<Record<string, unknown>> }>;
    const iframe = element.props.children;
    assert.equal(iframe.type, "iframe");
    assert.equal(iframe.props.onLoad, undefined);
    assert.equal(iframe.props.ref, undefined);
  });
});

describe("focus after activating Play", () => {
  // The rule depends only on where focus is when the button is about to
  // unmount; each case names the activation that produces that focus state.
  const button = {};
  const body = {};
  const elsewhere = {};

  const cases: [string, unknown, boolean][] = [
    ["keyboard Enter or Space on the focused button", button, true],
    ["mouse click in Chrome, Edge or Windows Firefox, which focuses the button", button, true],
    ["Android touch, which focuses the button", button, true],
    ["screen-reader activation that moves focus first, then clicks", button, true],
    ["mouse click in Safari or macOS Firefox, which does not focus buttons", body, false],
    ["iOS touch, which does not focus buttons", body, false],
    ["screen-reader browse-mode activation with focus left on another control", elsewhere, false],
    ["programmatic click() while nothing is focused", null, false],
  ];

  for (const [activation, activeElement, expected] of cases) {
    it(`${expected ? "moves" : "leaves"} focus: ${activation}`, () => {
      assert.equal(shouldMoveFocusOnActivate(activeElement, button), expected);
    });
  }

  it("never treats a missing button as owning focus", () => {
    assert.equal(shouldMoveFocusOnActivate(null, null), false);
  });
});

describe("video player poster (project cover as thumbnail)", () => {
  const poster = { src: "/media/cover-1600.webp", srcSet: "/media/cover-800.webp 800w, /media/cover-1600.webp 1600w", width: 1600, height: 900, alt: "Cover", blurDataUrl: null };

  it("shows the local cover lazily and decoratively behind the Play button, with no provider request", () => {
    const html = renderToStaticMarkup(
      React.createElement(VideoPlayer, {
        fallbackLabel: "Showreel",
        poster,
        video: { provider: "GOOGLE_DRIVE", videoId: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", title: null },
      }),
    );
    assert.match(html, /<img[^>]*alt=""[^>]*loading="lazy"[^>]*src="\/media\/cover-1600\.webp"/);
    assert.match(html, /<button[^>]*type="button"/);
    assert.ok(!html.includes("<iframe"), "no iframe until the visitor presses play");
    assert.ok(!html.includes("drive.google.com"), "no provider URL in the initial markup");
  });

  it("drops the poster once the visitor presses play", () => {
    const html = renderToStaticMarkup(
      React.createElement(VideoPlayerView, { embedUrl: "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345/preview", isActivated: true, label: "Showreel", onActivate: () => {}, poster }),
    );
    assert.match(html, /<iframe[^>]*src="https:\/\/drive\.google\.com\/file\/d\/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\/preview"/);
    assert.ok(!html.includes("cover-1600"));
  });

  it("renders without a poster exactly as before", () => {
    const html = view(false);
    assert.ok(!html.includes("<img"));
  });
});
