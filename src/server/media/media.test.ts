import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { MEDIA_MAX_BYTES } from "@/lib/media";
import { createMediaKeyPrefix, objectKey } from "@/server/media/keys";
import { MediaValidationError, processImage } from "@/server/media/processing";

describe("media object keys", () => {
  it("creates safe, filename-independent paths", () => {
    const prefix = createMediaKeyPrefix(new Date("2026-09-07T00:00:00Z"), "123e4567-e89b-12d3-a456-426614174000");
    assert.equal(objectKey(prefix, "w640.webp"), "media/2026/09/123e4567-e89b-12d3-a456-426614174000/w640.webp");
    assert.throws(() => objectKey(prefix, "../../secret"));
  });
});

describe("image processing", () => {
  it("preserves ratio, avoids upscale, and strips metadata", async () => {
    const source = await sharp({ create: { width: 500, height: 250, channels: 3, background: "#86705b" } }).withMetadata({ exif: { IFD0: { Artist: "private" } } }).jpeg().toBuffer();
    const result = await processImage(source);
    assert.deepEqual([result.master.width, result.master.height], [500, 250]);
    assert.ok(result.variants.every((variant) => variant.width <= 500));
    const metadata = await sharp(result.master.buffer).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.iptc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.match(result.blurDataUrl, /^data:image\/webp;base64,/);
  });
  it("rejects malformed and oversized inputs", async () => {
    await assert.rejects(() => processImage(Buffer.from("not an image")), MediaValidationError);
    await assert.rejects(() => processImage(Buffer.alloc(MEDIA_MAX_BYTES + 1)), /15 MB/);
  });
});
