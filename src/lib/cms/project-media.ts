export type ProjectMediaOption = {
  id: string;
  originalName: string;
  altText: string | null;
  /** Public URL of the 320 px thumbnail; `null` when the variant is missing or not loaded yet. */
  thumbnailUrl: string | null;
};

/** The media columns the project editor needs, with only the thumbnail variant. */
export const PROJECT_MEDIA_OPTION_SELECT = {
  id: true,
  originalName: true,
  altText: true,
  variants: {
    where: { variant: "THUMBNAIL" },
    select: { objectKey: true },
    take: 1,
  },
} as const;

/** Maps a row selected with `PROJECT_MEDIA_OPTION_SELECT` to a picker option. */
export function toProjectMediaOption(
  row: {
    id: string;
    originalName: string;
    altText: string | null;
    variants: readonly { objectKey: string }[];
  },
  urlFor: (objectKey: string) => string,
): ProjectMediaOption {
  const thumbnail = row.variants[0];
  return {
    id: row.id,
    originalName: row.originalName,
    altText: row.altText,
    thumbnailUrl: thumbnail ? urlFor(thumbnail.objectKey) : null,
  };
}

/** Keep every attached item first and in its stored order, then add picker items. */
export function mergeProjectMediaOptions(
  attached: readonly ProjectMediaOption[],
  recent: readonly ProjectMediaOption[],
): ProjectMediaOption[] {
  const seen = new Set<string>();

  return [...attached, ...recent].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function appendProjectMedia(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeProjectMedia(ids: readonly string[], id: string): string[] {
  return ids.filter((candidate) => candidate !== id);
}

export function moveProjectMedia(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];

  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Moves an attached image to the front; the first image is the cover. */
export function makeProjectMediaCover(ids: readonly string[], id: string): string[] {
  if (!ids.includes(id)) return [...ids];
  return [id, ...ids.filter((candidate) => candidate !== id)];
}

export function projectMediaRows(mediaIds: readonly string[]) {
  return mediaIds.map((mediaId, index) => ({
    mediaId,
    sortOrder: index,
    role: index === 0 ? ("COVER" as const) : ("GALLERY" as const),
  }));
}
