import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import sharp from "sharp";

import { SITE_THEME_COLOR } from "@/lib/constants";

/**
 * The temporary "MV" site icon: one SVG master in `src/app/`, served by
 * Next.js's file conventions, plus two rasters derived from it by
 * `scripts/generate-icons.mjs`.
 */

const SVG_PATH = "src/app/icon.svg";
const ICO_PATH = "src/app/favicon.ico";
const APPLE_PATH = "src/app/apple-icon.png";
const svg = readFileSync(SVG_PATH, "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css)![1]!.toLowerCase();
const luminance = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** PNG width, height and colour type from the IHDR chunk. */
function pngHeader(png: Buffer) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] };
}

/** The same rendering `scripts/generate-icons.mjs` performs, decoded to raw RGB. */
async function renderRaw(size: number) {
  return sharp(Buffer.from(svg), { density: (72 * 512) / 64 }).resize(size, size, { kernel: "lanczos3" }).flatten({ background: SITE_THEME_COLOR }).removeAlpha().raw().toBuffer();
}

async function meanDifference(png: Buffer, size: number) {
  const [actual, expected] = await Promise.all([sharp(png).removeAlpha().raw().toBuffer(), renderRaw(size)]);
  assert.equal(actual.length, expected.length);
  let total = 0;
  for (let i = 0; i < actual.length; i++) total += Math.abs(actual[i]! - expected[i]!);
  return total / actual.length;
}

describe("site icon master (SVG)", () => {
  it("is a square, self-contained vector with no text, images, scripts or external references", () => {
    assert.match(svg, /viewBox="0 0 64 64"/);
    assert.doesNotMatch(svg, /<text|<image|<script|<style|<foreignObject|href=|url\(|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  });

  it("uses only the site's own palette: theme background, foreground and accent", () => {
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1]!.toLowerCase());
    assert.deepEqual([...new Set(fills)].sort(), [token("accent"), token("foreground"), SITE_THEME_COLOR.toLowerCase()].sort());
    assert.equal(token("background"), SITE_THEME_COLOR.toLowerCase(), "theme colour and page background agree");
  });

  it("keeps both letters well above 4.5:1 against its background", () => {
    assert.ok(contrast(token("foreground"), SITE_THEME_COLOR) >= 4.5, "M (foreground)");
    assert.ok(contrast(token("accent"), SITE_THEME_COLOR) >= 4.5, "V (accent)");
  });

  it("draws on whole units of a 4-unit grid, so edges fall on pixel boundaries at 16, 32 and 48 px", () => {
    const numbers = [...svg.matchAll(/\sd="([^"]+)"/g)].flatMap((m) => m[1]!.match(/-?\d+(\.\d+)?/g)!.map(Number));
    assert.ok(numbers.length > 0);
    assert.ok(numbers.every((n) => Number.isInteger(n) && n % 2 === 0), `path coordinates: ${numbers.join(" ")}`);
  });
});

describe("favicon.ico", () => {
  const ico = readFileSync(ICO_PATH);

  it("is an icon container holding 16, 32 and 48 px PNG frames", () => {
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1, "type: icon");
    const count = ico.readUInt16LE(4);
    const frames = Array.from({ length: count }, (_, i) => {
      const entry = 6 + 16 * i;
      const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
      return { declared: ico[entry]!, bpp: ico.readUInt16LE(entry + 6), header: pngHeader(png) };
    });
    assert.deepEqual(frames.map((f) => f.declared), [16, 32, 48]);
    for (const frame of frames) {
      assert.equal(frame.header.width, frame.declared);
      assert.equal(frame.header.height, frame.declared);
      assert.equal(frame.bpp, 32);
    }
  });

  it("matches a fresh rendering of the SVG at every size (rasters regenerated after the last SVG change)", async () => {
    const count = ico.readUInt16LE(4);
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
      assert.ok((await meanDifference(png, ico[entry]!)) < 2, `${ico[entry]} px frame is stale; run node scripts/generate-icons.mjs`);
    }
  });
});

describe("apple-icon.png", () => {
  const png = readFileSync(APPLE_PATH);

  it("is a 180 x 180 opaque PNG, as iOS expects for home-screen icons", () => {
    assert.deepEqual(pngHeader(png), { width: 180, height: 180, colorType: 2 });
  });

  it("matches a fresh rendering of the SVG", async () => {
    assert.ok((await meanDifference(png, 180)) < 2, "apple-icon.png is stale; run node scripts/generate-icons.mjs");
  });
});

describe("icon wiring", () => {
  it("relies on Next.js file conventions alone, with no competing declaration", () => {
    for (const file of [SVG_PATH, ICO_PATH, APPLE_PATH]) assert.ok(existsSync(file), file);
    assert.ok(!existsSync("public/favicon.ico"), "no second favicon in public/");
    assert.doesNotMatch(readFileSync("src/app/layout.tsx", "utf8"), /\bicons\s*:/, "root metadata declares no icons of its own");
  });
});
