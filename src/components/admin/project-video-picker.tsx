"use client";

import { useEffect, useRef, useState } from "react";

import {
  appendProjectMedia,
  moveProjectMedia,
  removeProjectMedia,
} from "@/lib/cms/project-media";
import {
  isAssignableVideo,
  PROJECT_VIDEO_SECTION_FIELD,
  projectVideoFacts,
  type ProjectVideoOption,
} from "@/lib/cms/project-videos";

/**
 * The uploaded videos of a project, in public display order (P3-11E).
 *
 * Shown to ADMIN and SUPER_ADMIN only. Remove takes a video off this project;
 * it stays in the video library. Only READY videos are offered, and the server
 * checks READY again under a row lock when the project is saved.
 */
export function ProjectVideoPicker({
  initialVideoIds,
  videos,
}: {
  initialVideoIds: string[];
  videos: ProjectVideoOption[];
}) {
  const [selectedIds, setSelectedIds] = useState(initialVideoIds);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const selector = focusNext.current;
    focusNext.current = null;
    if (selector) rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [selectedIds]);

  const byId = new Map(videos.map((video) => [video.id, video]));
  const selected = selectedIds.flatMap((id) => {
    const video = byId.get(id);
    return video ? [video] : [];
  });
  const available = videos.filter((video) => !selectedIds.includes(video.id) && isAssignableVideo(video));

  function move(video: ProjectVideoOption, index: number, offset: -1 | 1) {
    const to = index + offset;
    if (to === 0) focusNext.current = `[data-video-down="${video.id}"]`;
    else if (to === selected.length - 1) focusNext.current = `[data-video-up="${video.id}"]`;
    setAnnouncement(`${video.title} moved to position ${to + 1} of ${selected.length}.`);
    setSelectedIds((ids) => moveProjectMedia(ids, video.id, offset));
  }

  function remove(video: ProjectVideoOption, index: number) {
    const neighbour = selected[index + 1] ?? selected[index - 1];
    focusNext.current = neighbour
      ? `[data-video-remove="${neighbour.id}"]`
      : isAssignableVideo(video)
        ? `[data-video-add="${video.id}"]`
        : null;
    setAnnouncement(`${video.title} removed from this project. It stays in the video library.`);
    setSelectedIds((ids) => removeProjectMedia(ids, video.id));
  }

  function add(video: ProjectVideoOption, index: number) {
    const neighbour = available[index + 1] ?? available[index - 1];
    focusNext.current = neighbour ? `[data-video-add="${neighbour.id}"]` : `[data-video-remove="${video.id}"]`;
    setAnnouncement(`${video.title} added as video ${selected.length + 1}.`);
    setSelectedIds((ids) => appendProjectMedia(ids, video.id));
  }

  return (
    <fieldset className="grid gap-4 border border-border p-4" ref={rootRef}>
      <legend>Videos</legend>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="text-sm text-muted-foreground">
        Uploaded videos appear in the Films section of the public project page,
        in this order, once the project is published. Only ready videos can be
        added. Removing a video here keeps it in the video library.
      </p>

      <input name={PROJECT_VIDEO_SECTION_FIELD} type="hidden" value="1" />
      {selected.map((video) => (
        <input key={video.id} name="videoIds" type="hidden" value={video.id} />
      ))}

      {selected.length ? (
        <ol className="grid gap-2" aria-label="Selected project videos in display order">
          {selected.map((video, index) => (
            <li
              className="grid gap-3 border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              data-video-row={video.id}
              key={video.id}
            >
              <span>
                <span className="font-medium">
                  {index + 1}. {video.title}
                </span>
                <span className="block text-xs text-muted-foreground">{projectVideoFacts(video)}</span>
                {isAssignableVideo(video) ? null : (
                  <span className="block text-xs text-accent" role="note">
                    Not ready. Remove it before saving.
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  aria-label={`Move ${video.title} earlier`}
                  className="min-h-10 border border-border px-3 disabled:opacity-40"
                  data-video-up={video.id}
                  disabled={index === 0}
                  onClick={() => move(video, index, -1)}
                  type="button"
                >
                  Up
                </button>
                <button
                  aria-label={`Move ${video.title} later`}
                  className="min-h-10 border border-border px-3 disabled:opacity-40"
                  data-video-down={video.id}
                  disabled={index === selected.length - 1}
                  onClick={() => move(video, index, 1)}
                  type="button"
                >
                  Down
                </button>
                <button
                  aria-label={`Remove ${video.title} from project`}
                  className="min-h-10 border border-border px-3"
                  data-video-remove={video.id}
                  onClick={() => remove(video, index)}
                  type="button"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">No videos selected.</p>
      )}

      {available.length ? (
        <div>
          <h3 className="text-sm font-semibold">Ready videos</h3>
          <ul className="mt-2 grid gap-2">
            {available.map((video, index) => (
              <li className="flex items-center justify-between gap-3" key={video.id}>
                <span className="text-sm">
                  {video.title} · {projectVideoFacts(video)}
                </span>
                <button
                  aria-label={`Add ${video.title} to project`}
                  className="min-h-10 border border-border px-3"
                  data-video-add={video.id}
                  onClick={() => add(video, index)}
                  type="button"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No other ready videos. Upload videos in the video library.
        </p>
      )}
    </fieldset>
  );
}
