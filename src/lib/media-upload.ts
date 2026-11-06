import { MEDIA_ACCEPTED_TYPES, formatBytes } from "@/lib/media";

/**
 * Browser-side preparation of a photo before `POST /api/media`.
 *
 * The server pipeline is unchanged: it still validates the bytes, applies EXIF
 * orientation, strips metadata, caps the master at 2560 px, and writes WebP
 * variants. This step only makes large camera files small enough to reach it.
 * A file that already fits is sent untouched, so nothing is re-encoded twice.
 *
 * Re-encoding happens only when the long edge exceeds UPLOAD_MAX_EDGE or the
 * file exceeds UPLOAD_TARGET_BYTES. The decoded image is oriented by the
 * browser (`imageOrientation: "from-image"`), so the pixels are drawn upright
 * and the EXIF orientation tag, which the canvas drops, is no longer needed.
 */

/** The server's own master cap (`processing.ts`); uploading more pixels than this gains nothing. */
export const UPLOAD_MAX_EDGE = 2560;

/**
 * The request budget for one photo. The server accepts up to MEDIA_MAX_BYTES,
 * but on Netlify the upload runs inside a function whose request-body limit is
 * lower (commonly documented at about 6 MB, UNVERIFIED for this deployment),
 * and multipart framing adds overhead. 4 MB leaves margin while a 2560 px JPEG
 * at the qualities below is typically 1–3 MB.
 */
export const UPLOAD_TARGET_BYTES = 4 * 1024 * 1024;

/** Tried in order until the encoded file fits UPLOAD_TARGET_BYTES. */
export const JPEG_QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76] as const;

type AcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];

export class UploadPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadPreparationError";
  }
}

export const PREPARATION_MESSAGES = {
  unsupported: "That file type is not supported. Choose a JPEG, PNG, or WebP image.",
  unreadable:
    "This image could not be read by your browser, and it is too large to upload unchanged. Export it as a JPEG and try again.",
  tooLarge: `This image is still larger than ${formatBytes(UPLOAD_TARGET_BYTES)} after resizing. Export it as a JPEG with a lower quality setting and try again.`,
} as const;

export function isAcceptedImageType(type: string): type is AcceptedType {
  return (MEDIA_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** Scales width × height so the long edge is at most `maxEdge`, preserving the aspect ratio. Never enlarges. */
export function fitWithin(width: number, height: number, maxEdge = UPLOAD_MAX_EDGE): { width: number; height: number } {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    throw new RangeError("Image dimensions must be positive numbers.");
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Whether a decoded image can be sent as it is. */
export function canUploadOriginal(image: { size: number; width: number; height: number }): boolean {
  return Math.max(image.width, image.height) <= UPLOAD_MAX_EDGE && image.size <= UPLOAD_TARGET_BYTES;
}

export type EncodeAttempt = { type: AcceptedType; quality?: number };

/**
 * Output formats to try, by input type. JPEG stays JPEG. PNG stays PNG, so
 * transparency survives. WebP is tried as WebP first and falls back to PNG,
 * because some browsers cannot encode WebP; neither loses transparency.
 */
export function encodeAttempts(inputType: AcceptedType): EncodeAttempt[] {
  if (inputType === "image/jpeg") return JPEG_QUALITY_STEPS.map((quality) => ({ type: "image/jpeg", quality }));
  if (inputType === "image/webp") {
    return [...JPEG_QUALITY_STEPS.map((quality) => ({ type: "image/webp" as const, quality })), { type: "image/png" }];
  }
  return [{ type: "image/png" }];
}

const EXTENSIONS: Record<AcceptedType, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/** The original base name with the extension of the encoded type. The server stores names as display metadata only. */
export function preparedFileName(originalName: string, type: AcceptedType): string {
  const base = originalName.replace(/\.[^./\\]*$/, "").trim() || "image";
  return `${base}${EXTENSIONS[type]}`;
}

/** A decoded, upright image. */
export type DecodedImage = { width: number; height: number; close(): void };

/** Draws a decoded image once at the target size, then encodes it as often as needed. */
export type ImageSurface = { encode(type: AcceptedType, quality?: number): Promise<Blob | null>; dispose(): void };

export type ImageCodec = {
  decode(file: File): Promise<DecodedImage>;
  draw(image: DecodedImage, width: number, height: number): ImageSurface;
};

export type PreparedUpload = { file: File; resized: boolean };

/**
 * Returns the file to upload: the original when it already fits, otherwise a
 * resized re-encode within UPLOAD_TARGET_BYTES. Throws UploadPreparationError
 * with a message meant for the person uploading.
 */
export async function prepareImageForUpload(file: File, codec: ImageCodec = browserImageCodec()): Promise<PreparedUpload> {
  // An empty type is left to the server, which inspects the bytes anyway.
  if (file.type && !isAcceptedImageType(file.type)) throw new UploadPreparationError(PREPARATION_MESSAGES.unsupported);

  let image: DecodedImage;
  try {
    image = await codec.decode(file);
  } catch {
    // The browser cannot read it, but the server might (it uses its own decoder).
    if (file.size <= UPLOAD_TARGET_BYTES) return { file, resized: false };
    throw new UploadPreparationError(PREPARATION_MESSAGES.unreadable);
  }

  try {
    if (canUploadOriginal({ size: file.size, width: image.width, height: image.height })) return { file, resized: false };
    if (!isAcceptedImageType(file.type)) throw new UploadPreparationError(PREPARATION_MESSAGES.unsupported);

    const target = fitWithin(image.width, image.height);
    let surface: ImageSurface;
    try {
      surface = codec.draw(image, target.width, target.height);
    } catch {
      throw new UploadPreparationError(PREPARATION_MESSAGES.unreadable);
    }
    try {
      for (const attempt of encodeAttempts(file.type)) {
        const blob = await surface.encode(attempt.type, attempt.quality);
        if (!blob || blob.size === 0 || blob.size > UPLOAD_TARGET_BYTES || !isAcceptedImageType(blob.type)) continue;
        return {
          file: new File([blob], preparedFileName(file.name, blob.type), { type: blob.type, lastModified: Date.now() }),
          resized: true,
        };
      }
      throw new UploadPreparationError(PREPARATION_MESSAGES.tooLarge);
    } finally {
      surface.dispose();
    }
  } finally {
    image.close();
  }
}

// ------------------------------------------------------------------ browser codec

/**
 * Canvas area above which some mobile browsers (notably iOS Safari) fail to
 * draw. Intermediate downscaling steps are skipped rather than exceed it.
 */
const SAFE_CANVAS_AREA = 16_000_000;

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function context(element: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

async function decodeInBrowser(file: File): Promise<DecodedImage & { source: CanvasImageSource }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the image element, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    // `naturalWidth`/`naturalHeight` and `drawImage` follow EXIF orientation (CSS `image-orientation: from-image`).
    return { source: element, width: element.naturalWidth, height: element.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * The real codec: decodes with orientation applied, downscales in halving steps
 * for quality (each step within SAFE_CANVAS_AREA), and encodes with `toBlob`.
 * The canvas carries no EXIF or GPS metadata.
 */
export function browserImageCodec(): ImageCodec {
  const sources = new WeakMap<DecodedImage, CanvasImageSource>();
  return {
    async decode(file) {
      const decoded = await decodeInBrowser(file);
      const image: DecodedImage = { width: decoded.width, height: decoded.height, close: decoded.close };
      sources.set(image, decoded.source);
      return image;
    },
    draw(image, width, height) {
      let source = sources.get(image);
      if (!source) throw new Error("Unknown image.");
      let currentWidth = image.width;
      let currentHeight = image.height;
      const intermediates: HTMLCanvasElement[] = [];
      while (currentWidth / 2 > width) {
        const nextWidth = Math.round(currentWidth / 2);
        const nextHeight = Math.round(currentHeight / 2);
        if (nextWidth * nextHeight > SAFE_CANVAS_AREA) break;
        const step = canvas(nextWidth, nextHeight);
        context(step).drawImage(source, 0, 0, nextWidth, nextHeight);
        intermediates.push(step);
        source = step;
        currentWidth = nextWidth;
        currentHeight = nextHeight;
      }
      const output = canvas(width, height);
      context(output).drawImage(source, 0, 0, width, height);
      for (const step of intermediates) step.width = step.height = 0;
      return {
        encode: (type, quality) => new Promise((resolve) => output.toBlob(resolve, type, quality)),
        dispose: () => {
          output.width = output.height = 0;
        },
      };
    },
  };
}
