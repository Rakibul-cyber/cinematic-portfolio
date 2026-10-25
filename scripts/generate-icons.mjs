/**
 * Raster icons from the vector master.
 *
 * `src/app/icon.svg` is the single source of the site icon. Next.js serves it
 * directly to browsers that accept SVG favicons; this script derives the two
 * raster files the platform conventions still need:
 *
 *   src/app/favicon.ico     16, 32 and 48 px PNG frames, for browsers and tools
 *                           that ask for /favicon.ico
 *   src/app/apple-icon.png  180 x 180 px, opaque, for iOS and iPadOS home screens
 *
 * Uses `sharp`, already a dependency for media processing; nothing is fetched.
 * Re-run after changing the SVG:
 *
 *   node scripts/generate-icons.mjs
 *
 * The icon is a temporary "MV" monogram, not an approved logo. Replacing it
 * means replacing `src/app/icon.svg` and running this script again.
 */
import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

const SOURCE = "src/app/icon.svg";
const FAVICON = "src/app/favicon.ico";
const APPLE_ICON = "src/app/apple-icon.png";
export const FAVICON_SIZES = [16, 32, 48];
export const APPLE_ICON_SIZE = 180;
const BACKGROUND = "#0f0f0e";

/** Renders the SVG well above the target size, then downsamples, so small sizes stay crisp. */
async function render(svg, size, { alpha }) {
  const image = sharp(svg, { density: (72 * 512) / 64 })
    .resize(size, size, { kernel: "lanczos3" })
    .flatten({ background: BACKGROUND });
  return (alpha ? image.ensureAlpha() : image.removeAlpha())
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

/** A minimal ICO container holding PNG frames (supported by every current browser). */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + 16 * frames.length;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

export async function buildIcons() {
  const svg = await readFile(SOURCE);
  const frames = [];
  for (const size of FAVICON_SIZES) frames.push({ size, png: await render(svg, size, { alpha: true }) });
  return { favicon: ico(frames), appleIcon: await render(svg, APPLE_ICON_SIZE, { alpha: false }) };
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/").replace(/^\//, "")}`) {
  const { favicon, appleIcon } = await buildIcons();
  await writeFile(FAVICON, favicon);
  await writeFile(APPLE_ICON, appleIcon);
  console.log(`Wrote ${FAVICON} (${FAVICON_SIZES.join(", ")} px, ${favicon.length} bytes) and ${APPLE_ICON} (${APPLE_ICON_SIZE} px, ${appleIcon.length} bytes).`);
}
