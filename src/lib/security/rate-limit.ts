import { createHmac } from "node:crypto";

export function pseudonymousKey(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
