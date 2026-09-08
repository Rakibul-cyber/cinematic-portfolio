import sharp, { type Metadata } from "sharp";

import { MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_DIMENSION } from "@/lib/media";

export type ProcessedImage = {
  width: number;
  height: number;
  master: ProcessedVariant;
  variants: ProcessedVariant[];
  blurDataUrl: string;
};
export type ProcessedVariant = { name: "thumbnail" | "w640" | "w1280" | "w1920" | "master"; width: number; height: number; mimeType: "image/webp"; buffer: Buffer };

const widthSpecs = [{ name: "thumbnail", width: 320, quality: 76 }, { name: "w640", width: 640, quality: 82 }, { name: "w1280", width: 1280, quality: 84 }, { name: "w1920", width: 1920, quality: 85 }] as const;

export class MediaValidationError extends Error {}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MEDIA_MAX_BYTES) throw new MediaValidationError("The image exceeds the 15 MB upload limit.");
  let metadata: Metadata;
  try { metadata = await sharp(input, { limitInputPixels: MEDIA_MAX_DIMENSION ** 2 }).metadata(); }
  catch { throw new MediaValidationError("The selected file is not a valid supported image."); }
  const mime = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : null;
  if (!mime || !MEDIA_ACCEPTED_TYPES.includes(mime)) throw new MediaValidationError("That image format is not supported.");
  if (!metadata.width || !metadata.height || metadata.width > MEDIA_MAX_DIMENSION || metadata.height > MEDIA_MAX_DIMENSION) throw new MediaValidationError("The image dimensions are missing or exceed 12,000 pixels.");

  const render = async (name: ProcessedVariant["name"], width: number, quality: number) => {
    const { data, info } = await sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
    return { name, width: info.width, height: info.height, mimeType: "image/webp" as const, buffer: data };
  };
  const masterWidth = Math.min(metadata.width, 2560);
  const master = await render("master", masterWidth, 88);
  const variants = await Promise.all(widthSpecs.filter((v) => v.width < master.width).map((v) => render(v.name, v.width, v.quality)));
  if (!variants.some((v) => v.name === "thumbnail")) variants.unshift(await render("thumbnail", Math.min(320, master.width), 76));
  const blur = await sharp(input).rotate().resize({ width: 24, withoutEnlargement: true }).webp({ quality: 40 }).toBuffer();
  return { width: master.width, height: master.height, master, variants, blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}` };
}
