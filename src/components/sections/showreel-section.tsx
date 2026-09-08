import { FadeReveal } from "@/components/motion/fade-reveal";
import { VideoPlayer } from "@/components/public/video-player";
import { Container } from "@/components/ui/container";
import { sectionLabels } from "@/content/site";
import type { VideoRef } from "@/lib/video";

type ShowreelSectionProps = {
  showreel: VideoRef | null;
  studioName: string;
};

/**
 * Homepage showreel.
 *
 * Rendered only when a real showreel is configured in site settings. No video
 * identifier is ever invented, so an unconfigured showreel removes the section
 * rather than producing a dead player.
 *
 * Nothing is requested from the video provider until the visitor presses play.
 */
export function ShowreelSection({ showreel, studioName }: ShowreelSectionProps) {
  if (!showreel) return null;

  return (
    <section
      aria-labelledby="showreel-title"
      className="border-y border-border bg-surface py-24 sm:py-32"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
                {sectionLabels.showreel}
              </p>
              <h2
                className="editorial-balance max-w-4xl font-display text-[clamp(3rem,7vw,7rem)] leading-[0.88] font-medium tracking-[-0.035em]"
                id="showreel-title"
              >
                {showreel.title ?? "Showreel"}
              </h2>
            </div>
          </div>

          <VideoPlayer
            className="mt-14 sm:mt-20"
            fallbackLabel={`the ${studioName} showreel`}
            video={showreel}
          />
        </FadeReveal>
      </Container>
    </section>
  );
}
