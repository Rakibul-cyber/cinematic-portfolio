"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { uploadFailureMessage } from "@/app/(admin)/admin/media/upload-form";
import { ADMIN_MEDIA_PATH } from "@/lib/admin-routes";
import {
  appendProjectMedia,
  makeProjectMediaCover,
  moveProjectMedia,
  removeProjectMedia,
  type ProjectMediaOption,
} from "@/lib/cms/project-media";
import { MEDIA_ACCEPT } from "@/lib/media";
import {
  UploadPreparationError,
  prepareImageForUpload,
  type PreparedUpload,
} from "@/lib/media-upload";

type PickerNotice = { message: string; tone: "alert" | "status" };

/** A failure whose message is safe and useful to show to the editor. */
class UploadFailure extends Error {}

const controlClass = "min-h-10 border border-border px-3 text-sm disabled:opacity-40";

function Thumbnail({ item, className }: { item: ProjectMediaOption; className: string }) {
  return (
    <span className={`block overflow-hidden bg-muted ${className}`}>
      {/* R2 already serves the purpose-built 320px derivative. */}
      {item.thumbnailUrl ? (
        <img
          alt={item.altText ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          src={item.thumbnailUrl}
        />
      ) : null}
    </span>
  );
}

/**
 * Images attached to a project, in public order; the first one is the cover.
 *
 * Images are uploaded here through the same `/api/media` route as the Media
 * library, or added from the library. An upload is stored in the library at
 * once; it is attached to the project only when the project is saved, and
 * removing an image here never deletes it from the library or from storage.
 *
 * The picker sits inside the project `<form>`, so the file input has no `name`
 * (it is never submitted with the project) and uploads on change.
 */
export function ProjectMediaPicker({
  initialMediaIds,
  media,
  prepareFile = prepareImageForUpload,
}: {
  initialMediaIds: string[];
  media: ProjectMediaOption[];
  /** Replaceable in tests; the browser implementation resizes large photos before upload. */
  prepareFile?: (file: File) => Promise<PreparedUpload>;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState(initialMediaIds);
  // Images uploaded here, shown by name until the refreshed page supplies
  // their thumbnails through `media`.
  const [uploaded, setUploaded] = useState<ProjectMediaOption[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<PickerNotice | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
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

  // A library row replaces the placeholder of the same upload.
  const byId = new Map([...uploaded, ...media].map((item) => [item.id, item]));
  const selected = selectedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const available = [...byId.values()].filter((item) => !selectedIds.includes(item.id));

  function move(item: ProjectMediaOption, index: number, offset: -1 | 1) {
    const to = index + offset;
    if (to === 0) focusNext.current = `[data-down="${item.id}"]`;
    else if (to === selected.length - 1) focusNext.current = `[data-up="${item.id}"]`;
    setAnnouncement(`${item.originalName} moved to position ${to + 1} of ${selected.length}.`);
    setSelectedIds((ids) => moveProjectMedia(ids, item.id, offset));
  }

  function makeCover(item: ProjectMediaOption) {
    // Its own "Make cover" button disappears once it is first.
    focusNext.current = `[data-down="${item.id}"]`;
    setAnnouncement(`${item.originalName} is now the cover image.`);
    setSelectedIds((ids) => makeProjectMediaCover(ids, item.id));
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

  async function uploadOne(file: File): Promise<ProjectMediaOption> {
    let prepared: PreparedUpload;
    try {
      prepared = await prepareFile(file);
    } catch (error) {
      throw new UploadFailure(
        error instanceof UploadPreparationError
          ? error.message
          : "The image could not be prepared for upload. Export it as a JPEG and try again.",
      );
    }
    const data = new FormData();
    data.set("file", prepared.file, prepared.file.name);
    const response = await fetch("/api/media", { method: "POST", body: data });
    // A platform error page (for example a 413 before the route runs) is not JSON.
    const result = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !result.id) {
      throw new UploadFailure(result.message ?? uploadFailureMessage(response.status));
    }
    return { id: result.id, originalName: file.name, altText: null, thumbnailUrl: null };
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    setNotice(null);
    const added: ProjectMediaOption[] = [];
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress(
        files.length > 1
          ? `Uploading image ${index + 1} of ${files.length}…`
          : "Uploading image…",
      );
      try {
        added.push(await uploadOne(file));
      } catch (error) {
        failures.push(
          `${file.name}: ${
            error instanceof UploadFailure
              ? error.message
              : "The image could not be uploaded. Check your connection and try again."
          }`,
        );
      }
    }
    // Lets the same file be chosen again after a failure.
    input.value = "";
    setProgress(null);
    if (added.length) {
      setUploaded((current) => [...current, ...added]);
      setSelectedIds((ids) => added.reduce((next, item) => appendProjectMedia(next, item.id), ids));
      // Reloads the library list, which supplies the new thumbnails. What the
      // editor typed in the project form is kept.
      router.refresh();
    }
    const addedMessage = added.length
      ? `${added.length === 1 ? "1 image" : `${added.length} images`} added. Save the project to keep ${added.length === 1 ? "it" : "them"}.`
      : "";
    setNotice(
      failures.length
        ? { message: [addedMessage, ...failures].filter(Boolean).join(" "), tone: "alert" }
        : { message: addedMessage, tone: "status" },
    );
  }

  const uploading = progress !== null;

  return (
    <fieldset className="grid gap-4 border border-border p-4" ref={rootRef}>
      <legend>Project media</legend>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="text-sm text-muted-foreground">
        Upload photos or add them from the Media library. The first image is
        the cover; the rest follow in the gallery in this order.
      </p>

      {selectedIds.map((id) => (
        <input key={id} name="mediaIds" type="hidden" value={id} />
      ))}

      <label className="grid gap-2 text-sm font-medium">
        Upload images
        <input
          accept={MEDIA_ACCEPT}
          aria-describedby="project-media-upload-hint"
          className="min-h-12 w-full border border-border bg-background p-3"
          data-upload
          disabled={uploading}
          multiple
          onChange={upload}
          type="file"
        />
        <span className="text-xs font-normal text-muted-foreground" id="project-media-upload-hint">
          JPEG, PNG, or WebP. You can choose several at once; large photos are
          resized in your browser first.
        </span>
      </label>
      <p
        aria-live={notice?.tone === "alert" ? undefined : "polite"}
        className="min-h-5 text-sm"
        data-upload-notice
        role={notice?.tone ?? "status"}
      >
        {progress ?? notice?.message ?? ""}
      </p>

      {selected.length ? (
        <ol className="grid gap-2" aria-label="Selected project media in display order">
          {selected.map((item, index) => (
            <li
              className="grid grid-cols-[5rem_1fr] items-center gap-3 border border-border p-3"
              key={item.id}
            >
              <Thumbnail className="size-20" item={item} />
              <span className="grid min-w-0 gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium" title={item.originalName}>
                    {index + 1}. {item.originalName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {index === 0 ? "Cover image" : "Gallery image"}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {index > 0 ? (
                    <button
                      aria-label={`Make ${item.originalName} the cover image`}
                      className={controlClass}
                      data-cover={item.id}
                      onClick={() => makeCover(item)}
                      type="button"
                    >
                      Make cover
                    </button>
                  ) : null}
                  <button
                    aria-label={`Move ${item.originalName} earlier`}
                    className={controlClass}
                    data-up={item.id}
                    disabled={index === 0}
                    onClick={() => move(item, index, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move ${item.originalName} later`}
                    className={controlClass}
                    data-down={item.id}
                    disabled={index === selected.length - 1}
                    onClick={() => move(item, index, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button
                    aria-label={`Remove ${item.originalName} from project`}
                    className={controlClass}
                    data-remove={item.id}
                    onClick={() => remove(item, index)}
                    type="button"
                  >
                    Remove
                  </button>
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">
          No images yet. Upload one above
          {available.length ? ", or add one from the Media library below" : ""}.
        </p>
      )}

      {available.length ? (
        <div>
          <h3 className="text-sm font-semibold">Add from the Media library</h3>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {available.map((item, index) => (
              <li className="grid min-w-0 gap-2 border border-border p-2" key={item.id}>
                <Thumbnail className="aspect-[4/3] w-full" item={item} />
                <span className="truncate text-xs" title={item.originalName}>
                  {item.originalName}
                </span>
                <button
                  aria-label={`Add ${item.originalName} to project`}
                  className={controlClass}
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

      <p className="text-xs text-muted-foreground">
        Removing an image here does not delete it. To edit alt text or delete
        images, open the{" "}
        <a className="underline" href={ADMIN_MEDIA_PATH} rel="noreferrer" target="_blank">
          Media library (new tab)
        </a>
        .
      </p>
    </fieldset>
  );
}
