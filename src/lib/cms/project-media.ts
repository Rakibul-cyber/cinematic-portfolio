export type ProjectMediaOption = {
  id: string;
  originalName: string;
  altText: string | null;
};

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

export function projectMediaRows(mediaIds: readonly string[]) {
  return mediaIds.map((mediaId, index) => ({
    mediaId,
    sortOrder: index,
    role: index === 0 ? ("COVER" as const) : ("GALLERY" as const),
  }));
}
