import { HlsPlayer } from "@/components/video/hls-player";
import type { PublicFilm } from "@/server/public/view-models";

/**
 * The Films section of a public project page (P3-11E): uploaded videos in
 * their saved order, each behind the click-to-load player.
 *
 * Nothing about playback is in the HTML: the player asks
 * `/api/videos/[id]/playback?projectId=` for a short-lived signed URL only
 * after the visitor presses Play, and that route re-checks that the project is
 * published in an active category and the video is READY.
 */
export function ProjectFilms({ films, projectTitle }: { films: PublicFilm[]; projectTitle: string }) {
  if (!films.length) return null;
  return (
    <section aria-labelledby="project-films-title" className="pb-20 sm:pb-28" data-project-films>
      <h2
        className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase"
        id="project-films-title"
      >
        Films
      </h2>
      <ol aria-label={`${projectTitle} films`} className="mt-8 grid gap-12">
        {films.map((film) => (
          <li data-film={film.videoId} key={film.videoId}>
            <article className="grid gap-4">
              <h3 className="text-sm font-medium">
                {film.title}
                {film.durationLabel ? (
                  <span className="ml-3 text-xs text-muted-foreground">{film.durationLabel}</span>
                ) : null}
              </h3>
              <HlsPlayer projectId={film.projectId} title={film.title} videoId={film.videoId} />
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
