"use client";

import { useState } from "react";

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
  const byId = new Map(media.map((item) => [item.id, item]));
  const selected = selectedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const available = media.filter((item) => !selectedIds.includes(item.id));

  return (
    <fieldset className="grid gap-4 border border-border p-4">
      <legend>Project media</legend>
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
                  disabled={index === 0}
                  onClick={() =>
                    setSelectedIds((ids) => moveProjectMedia(ids, item.id, -1))
                  }
                  type="button"
                >
                  Up
                </button>
                <button
                  aria-label={`Move ${item.originalName} later`}
                  className="min-h-10 border border-border px-3 disabled:opacity-40"
                  disabled={index === selected.length - 1}
                  onClick={() =>
                    setSelectedIds((ids) => moveProjectMedia(ids, item.id, 1))
                  }
                  type="button"
                >
                  Down
                </button>
                <button
                  aria-label={`Remove ${item.originalName} from project`}
                  className="min-h-10 border border-border px-3"
                  onClick={() =>
                    setSelectedIds((ids) => removeProjectMedia(ids, item.id))
                  }
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
            {available.map((item) => (
              <li className="flex items-center justify-between gap-3" key={item.id}>
                <span className="text-sm">
                  {item.originalName} · {item.altText || "alt text missing"}
                </span>
                <button
                  aria-label={`Add ${item.originalName} to project`}
                  className="min-h-10 border border-border px-3"
                  onClick={() =>
                    setSelectedIds((ids) => appendProjectMedia(ids, item.id))
                  }
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
