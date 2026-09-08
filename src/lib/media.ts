export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 12_000;
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp";
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
