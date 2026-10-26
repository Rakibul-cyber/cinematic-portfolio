"use client";

import { useEffect, useRef, useState } from "react";

import {
  appendProjectMedia,
  moveProjectMedia,
  removeProjectMedia,
  type ProjectMediaOption,
} from "@/lib/cms/project-media";

export function ProjectMediaPicker({
  initialMediaIds,
  media,
}: {
  initialMediaIds: string[];
  media: ProjectMediaOption[];
}) {
  const [selectedIds, setSelectedIds] = useState(initialMediaIds);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLFieldSetElement>(null);
  // The control to focus once the list re-renders: an added or removed item's
  // button disappears, and a moved item's button can become disabled at either
  // end, and either would otherwise drop focus to the page.
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const selector = focusNext.current;
    focusNext.current = null;
    if (selector) rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [selectedIds]);
  const byId = new Map(media.map((item) => [item.id, item]));
  const selected = selectedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const available = media.filter((item) => !selectedIds.includes(item.id));

  function move(item: ProjectMediaOption, index: number, offset: -1 | 1) {
    const to = index + offset;
    if (to === 0) focusNext.current = `[data-down="${item.id}"]`;
    else if (to === selected.length - 1) focusNext.current = `[data-up="${item.id}"]`;
    setAnnouncement(`${item.originalName} moved to position ${to + 1} of ${selected.length}.`);
    setSelectedIds((ids) => moveProjectMedia(ids, item.id, offset));
  }

  function remove(item: ProjectMediaOption, index: number) {
    // The next item, else the previous one, else the item's own Add button.
    const neighbour = selected[index + 1] ?? selected[index - 1];
    focusNext.current = neighbour ? `[data-remove="${neighbour.id}"]` : `[data-add="${item.id}"]`;
    setAnnouncement(`${item.originalName} removed from project.`);
    setSelectedIds((ids) => removeProjectMedia(ids, item.id));
  }

  function add(item: ProjectMediaOption, index: number) {
    // The next available image, so several can be added in a row; else the new item's Remove.
    const neighbour = available[index + 1] ?? available[index - 1];
    focusNext.current = neighbour ? `[data-add="${neighbour.id}"]` : `[data-remove="${item.id}"]`;
    setAnnouncement(`${item.originalName} added as image ${selected.length + 1}.`);
    setSelectedIds((ids) => appendProjectMedia(ids, item.id));
  }

  return (
    <fieldset className="grid gap-4 border border-border p-4" ref={rootRef}>
      <legend>Project media</legend>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="text-sm text-muted-foreground">
        The first selected image is the cover. Use the controls to set the
        public gallery order; newly added images are appended.
      </p>

      {selectedIds.map((id) => (
        <input key={id} name="mediaIds" type="hidden" value={id} />
      ))}

      {selected.length ? (
        <ol className="grid gap-2" aria-label="Selected project media in display order">
          {selected.map((item, index) => (
            <li
              className="grid gap-3 border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              key={item.id}
            >
              <span>
                <span className="font-medium">
                  {index + 1}. {item.originalName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {index === 0 ? "Cover image" : "Gallery image"} ·{" "}
                  {item.altText || "alt text missing"}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  aria-label={`Move ${item.originalName} earlier`}
                  className="min-h-10 border border-border px-3 disabled:opacity-40"
                  data-up={item.id}
                  disabled={index === 0}
                  onClick={() => move(item, index, -1)}
                  type="button"
                >
                  Up
                </button>
                <button
                  aria-label={`Move ${item.originalName} later`}
                  className="min-h-10 border border-border px-3 disabled:opacity-40"
                  data-down={item.id}
                  disabled={index === selected.length - 1}
                  onClick={() => move(item, index, 1)}
                  type="button"
                >
                  Down
                </button>
                <button
                  aria-label={`Remove ${item.originalName} from project`}
                  className="min-h-10 border border-border px-3"
                  data-remove={item.id}
                  onClick={() => remove(item, index)}
                  type="button"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">No media selected.</p>
      )}

      {available.length ? (
        <div>
          <h3 className="text-sm font-semibold">Available media</h3>
          <ul className="mt-2 grid gap-2">
            {available.map((item, index) => (
              <li className="flex items-center justify-between gap-3" key={item.id}>
                <span className="text-sm">
                  {item.originalName} · {item.altText || "alt text missing"}
                </span>
                <button
                  aria-label={`Add ${item.originalName} to project`}
                  className="min-h-10 border border-border px-3"
                  data-add={item.id}
                  onClick={() => add(item, index)}
                  type="button"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}
