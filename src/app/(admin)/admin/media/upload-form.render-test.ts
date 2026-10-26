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
    assert.match(source, /result\.message \?\? "Upload failed\."[\s\S]*tone: "alert"/);
    assert.match(source, /role=\{notice\?\.tone \?\? "status"\}/);
    assert.match(source, /aria-live=\{notice\?\.tone === "alert" \? undefined : "polite"\}/);
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
