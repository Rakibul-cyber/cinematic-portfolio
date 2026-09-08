import { FadeReveal } from "@/components/motion/fade-reveal";
import { MediaImage } from "@/components/public/media-image";
import type { PublicImage } from "@/lib/public/image-source";
import { cn } from "@/lib/utils";

type ProjectGalleryProps = {
  images: readonly PublicImage[];
};

/**
 * Editorial project gallery.
 *
 * A stacked CSS composition rather than a carousel or lightbox: no gallery
 * dependency, no client-side state, and every image is reachable by scrolling
 * alone. Images keep their own aspect ratio, so the layout never crops a
 * photograph to fit a grid cell.
 *
 * Order is the CMS order. Every image after the first is lazy-loaded.
 */
export function ProjectGallery({ images }: ProjectGalleryProps) {
  if (images.length === 0) return null;

  return (
    <div className="grid gap-6 sm:gap-10 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-16">
      {images.map((image, index) => {
        // Every third image runs full width; the others pair up on wide
        // screens, which keeps the rhythm without any per-image CMS field.
        const isFullWidth = index % 3 === 0;

        return (
          <FadeReveal
            className={cn(
              isFullWidth ? "lg:col-span-12" : "lg:col-span-6",
              !isFullWidth && index % 3 === 2 && "lg:col-start-7",
            )}
            delay={0.04}
            key={image.src}
          >
            <MediaImage
              image={image}
              sizes={
                isFullWidth
                  ? "(min-width: 1600px) 1400px, 100vw"
                  : "(min-width: 1024px) 46vw, 100vw"
              }
            />
          </FadeReveal>
        );
      })}
    </div>
  );
}
