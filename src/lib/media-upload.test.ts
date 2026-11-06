import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEDIA_MAX_BYTES } from "@/lib/media";
import {
  JPEG_QUALITY_STEPS,
  PREPARATION_MESSAGES,
  UPLOAD_MAX_EDGE,
  UPLOAD_TARGET_BYTES,
  UploadPreparationError,
  canUploadOriginal,
  encodeAttempts,
  fitWithin,
  preparedFileName,
  prepareImageForUpload,
  type ImageCodec,
} from "@/lib/media-upload";

/**
 * Browser-side photo preparation (P0-2). The canvas codec itself needs a real
 * browser; everything that decides what is uploaded runs here against a fake
 * codec that records what it was asked to do.
 */

describe("photo upload limits", () => {
  it("stay within the server's own limits", () => {
    assert.equal(UPLOAD_MAX_EDGE, 2560, "matches the server's master cap in processing.ts");
    assert.ok(UPLOAD_TARGET_BYTES <= MEDIA_MAX_BYTES, "never above the server's byte limit");
    assert.ok(JPEG_QUALITY_STEPS.every((q, i, all) => q > 0.7 && q <= 0.92 && (i === 0 || q < all[i - 1])), "descending, never harsh");
  });
});

describe("fitWithin", () => {
  it("scales the long edge to 2560 px and preserves the aspect ratio", () => {
    assert.deepEqual(fitWithin(6000, 4000), { width: 2560, height: 1707 });
    assert.deepEqual(fitWithin(4000, 6000), { width: 1707, height: 2560 });
    assert.deepEqual(fitWithin(8000, 8000), { width: 2560, height: 2560 });
    assert.deepEqual(fitWithin(12000, 500), { width: 2560, height: 107 });
  });

  it("never enlarges", () => {
    assert.deepEqual(fitWithin(2560, 1440), { width: 2560, height: 1440 });
    assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800 });
  });

  it("keeps at least one pixel on an extreme panorama", () => {
    assert.deepEqual(fitWithin(100000, 10), { width: 2560, height: 1 });
  });

  it("rejects impossible dimensions", () => {
    for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [Number.NaN, 5], [Number.POSITIVE_INFINITY, 5]]) {
      assert.throws(() => fitWithin(w, h), RangeError);
    }
  });
});

describe("upload decisions", () => {
  it("sends a file unchanged only when both its pixels and its bytes fit", () => {
    assert.equal(canUploadOriginal({ size: 2_000_000, width: 2560, height: 1707 }), true);
    assert.equal(canUploadOriginal({ size: 2_000_000, width: 2561, height: 1707 }), false);
    assert.equal(canUploadOriginal({ size: UPLOAD_TARGET_BYTES + 1, width: 2000, height: 1000 }), false);
  });

  it("keeps the input format so transparency survives", () => {
    assert.deepEqual(encodeAttempts("image/jpeg").map((a) => a.type), JPEG_QUALITY_STEPS.map(() => "image/jpeg"));
    assert.deepEqual(encodeAttempts("image/png"), [{ type: "image/png" }]);
    const webp = encodeAttempts("image/webp");
    assert.equal(webp.at(-1)?.type, "image/png", "lossless fallback when the browser cannot encode WebP");
    assert.ok(webp.slice(0, -1).every((a) => a.type === "image/webp"));
  });

  it("renames the file to its encoded type", () => {
    assert.equal(preparedFileName("DSC_0042.JPG", "image/jpeg"), "DSC_0042.jpg");
    assert.equal(preparedFileName("shoot.final.png", "image/png"), "shoot.final.png");
    assert.equal(preparedFileName("no-extension", "image/webp"), "no-extension.webp");
    assert.equal(preparedFileName(".jpg", "image/jpeg"), "image.jpg");
  });
});

type Call = { kind: string; detail?: unknown };

/** A codec that decodes to fixed dimensions and encodes to the sizes it is given, in order. */
function fakeCodec(options: { width: number; height: number; sizes?: number[]; decodeFails?: boolean; drawFails?: boolean; blobType?: string }) {
  const calls: Call[] = [];
  const sizes = [...(options.sizes ?? [])];
  const codec: ImageCodec = {
    async decode() {
      calls.push({ kind: "decode" });
      if (options.decodeFails) throw new Error("cannot decode");
      return { width: options.width, height: options.height, close: () => calls.push({ kind: "close" }) };
    },
    draw(_image, width, height) {
      calls.push({ kind: "draw", detail: { width, height } });
      if (options.drawFails) throw new Error("canvas too large");
      return {
        async encode(type, quality) {
          calls.push({ kind: "encode", detail: { type, quality } });
          const size = sizes.shift();
          if (size === undefined) return null;
          return new Blob([new Uint8Array(size)], { type: options.blobType ?? type });
        },
        dispose: () => calls.push({ kind: "dispose" }),
      };
    },
  };
  return { codec, calls };
}

const photo = (bytes: number, name = "DSC_0001.JPG", type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });
const kinds = (calls: Call[]) => calls.map((call) => call.kind);

describe("prepareImageForUpload", () => {
  it("returns a file that already fits untouched", async () => {
    const original = photo(1_500_000);
    const { codec, calls } = fakeCodec({ width: 2400, height: 1600 });
    const prepared = await prepareImageForUpload(original, codec);
    assert.equal(prepared.file, original);
    assert.equal(prepared.resized, false);
    assert.deepEqual(kinds(calls), ["decode", "close"]);
  });

  it("resizes a large camera JPEG to 2560 px at the first quality that fits", async () => {
    const { codec, calls } = fakeCodec({ width: 6000, height: 4000, sizes: [2_800_000] });
    const prepared = await prepareImageForUpload(photo(14_000_000), codec);
    assert.equal(prepared.resized, true);
    assert.equal(prepared.file.type, "image/jpeg");
    assert.equal(prepared.file.name, "DSC_0001.jpg");
    assert.equal(prepared.file.size, 2_800_000);
    assert.deepEqual(calls.find((c) => c.kind === "draw")?.detail, { width: 2560, height: 1707 });
    assert.deepEqual(calls.find((c) => c.kind === "encode")?.detail, { type: "image/jpeg", quality: 0.92 });
    assert.deepEqual(kinds(calls), ["decode", "draw", "encode", "dispose", "close"]);
  });

  it("re-encodes an oversized file even when its pixels already fit", async () => {
    const { codec, calls } = fakeCodec({ width: 1700, height: 2550, sizes: [1_200_000] });
    const prepared = await prepareImageForUpload(photo(UPLOAD_TARGET_BYTES + 1), codec);
    assert.equal(prepared.resized, true);
    assert.deepEqual(calls.find((c) => c.kind === "draw")?.detail, { width: 1700, height: 2550 }, "no enlargement, no shrink");
  });

  it("steps quality down until the file fits", async () => {
    const tooBig = UPLOAD_TARGET_BYTES + 1;
    const { codec, calls } = fakeCodec({ width: 9000, height: 6000, sizes: [tooBig, tooBig, 3_900_000] });
    const prepared = await prepareImageForUpload(photo(30_000_000), codec);
    assert.equal(prepared.file.size, 3_900_000);
    assert.deepEqual(
      calls.filter((c) => c.kind === "encode").map((c) => (c.detail as { quality: number }).quality),
      [0.92, 0.88, 0.84],
    );
  });

  it("fails clearly when no quality fits, and still releases the image", async () => {
    const tooBig = UPLOAD_TARGET_BYTES + 1;
    const { codec, calls } = fakeCodec({ width: 9000, height: 6000, sizes: JPEG_QUALITY_STEPS.map(() => tooBig) });
    await assert.rejects(prepareImageForUpload(photo(40_000_000), codec), (error: unknown) => {
      assert.ok(error instanceof UploadPreparationError);
      assert.equal(error.message, PREPARATION_MESSAGES.tooLarge);
      assert.match(error.message, /4\.0 MB/);
      return true;
    });
    assert.deepEqual(kinds(calls).slice(-2), ["dispose", "close"]);
  });

  it("skips an attempt the browser could not encode", async () => {
    const { codec } = fakeCodec({ width: 6000, height: 4000, sizes: [0, 2_000_000] });
    const prepared = await prepareImageForUpload(photo(10_000_000), codec);
    assert.equal(prepared.file.size, 2_000_000);
  });

  it("keeps PNG as PNG", async () => {
    const { codec, calls } = fakeCodec({ width: 5000, height: 5000, sizes: [3_000_000] });
    const prepared = await prepareImageForUpload(photo(9_000_000, "logo.png", "image/png"), codec);
    assert.equal(prepared.file.type, "image/png");
    assert.equal(prepared.file.name, "logo.png");
    assert.deepEqual(calls.find((c) => c.kind === "encode")?.detail, { type: "image/png", quality: undefined });
  });

  it("accepts the PNG a browser returns when it cannot encode WebP", async () => {
    const { codec } = fakeCodec({ width: 5000, height: 3000, sizes: [2_000_000], blobType: "image/png" });
    const prepared = await prepareImageForUpload(photo(8_000_000, "frame.webp", "image/webp"), codec);
    assert.equal(prepared.file.type, "image/png");
    assert.equal(prepared.file.name, "frame.png");
  });

  it("refuses a type the server does not accept before decoding it", async () => {
    const { codec, calls } = fakeCodec({ width: 4000, height: 3000 });
    await assert.rejects(prepareImageForUpload(photo(3_000_000, "IMG_0001.HEIC", "image/heic"), codec), {
      message: PREPARATION_MESSAGES.unsupported,
    });
    assert.deepEqual(calls, []);
  });

  it("leaves a small file the browser cannot read to the server's own validation", async () => {
    const original = photo(2_000_000);
    const { codec } = fakeCodec({ width: 1, height: 1, decodeFails: true });
    const prepared = await prepareImageForUpload(original, codec);
    assert.equal(prepared.file, original);
    assert.equal(prepared.resized, false);
  });

  it("explains when a large file cannot be read in the browser", async () => {
    const { codec } = fakeCodec({ width: 1, height: 1, decodeFails: true });
    await assert.rejects(prepareImageForUpload(photo(20_000_000), codec), {
      name: "UploadPreparationError",
      message: PREPARATION_MESSAGES.unreadable,
    });
  });

  it("explains when the browser cannot draw the image, and releases it", async () => {
    const { codec, calls } = fakeCodec({ width: 12000, height: 12000, drawFails: true });
    await assert.rejects(prepareImageForUpload(photo(25_000_000), codec), { message: PREPARATION_MESSAGES.unreadable });
    assert.equal(kinds(calls).at(-1), "close");
  });
});
