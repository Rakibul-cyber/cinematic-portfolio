import type { PublicImage } from "@/lib/public/image-source";
import { cn } from "@/lib/utils";

type MediaImageProps = {
  image: PublicImage;
  /** Matches the CSS layout so the browser picks the right `srcset` entry. */
  sizes: string;
  /** Tailwind aspect ratio class. Omitted to keep the image's own ratio. */
  ratioClassName?: string;
  className?: string;
  imageClassName?: string;
  /** Set only for the single above-the-fold LCP image on a page. */
  priority?: boolean;
};

/**
 * Public image rendering.
 *
 * Serves the Phase 3 WebP variants directly through `srcset` rather than
 * routing them through the Next.js image optimizer, because they are already
 * optimized, metadata-free, and generated at exactly the widths the layouts
 * use — a second pass would re-encode an optimal file for no gain (ADR 0005).
 * URLs arrive resolved from the server-side delivery helper, so no storage
 * host appears here.
 *
 * Intrinsic `width`/`height` are always emitted so the box is reserved before
 * the image arrives; the tiny Phase 3 blur placeholder fills that box in the
 * meantime as a plain CSS background, with no render-blocking work.
 */
export function MediaImage({
  className,
  image,
  imageClassName,
  priority = false,
  ratioClassName,
  sizes,
}: MediaImageProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-surface",
        ratioClassName,
        className,
      )}
      style={
        image.blurDataUrl
          ? {
              backgroundImage: `url("${image.blurDataUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see ADR 0005 */}
      <img
        alt={image.alt}
        className={cn(
          ratioClassName ? "absolute inset-0 size-full object-cover" : "w-full",
          imageClassName,
        )}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : undefined}
        height={image.height}
        loading={priority ? "eager" : "lazy"}
        sizes={sizes}
        src={image.src}
        srcSet={image.srcSet}
        width={image.width}
      />
    </div>
  );
}
