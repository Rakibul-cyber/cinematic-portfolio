import { randomUUID } from "node:crypto";

export function createMediaKeyPrefix(now = new Date(), id = randomUUID()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid media identifier");
  return `media/${year}/${month}/${id}`;
}

export function objectKey(prefix: string, name: string): string {
  if (!/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/i.test(prefix)) throw new Error("Invalid key prefix");
  if (!/^[a-z0-9-]+\.webp$/.test(name)) throw new Error("Invalid object name");
  return `${prefix}/${name}`;
}
