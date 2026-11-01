import "server-only";

import { isIP } from "node:net";

/**
 * Which client a rate limit should count a request against.
 *
 * Only Netlify's platform header is read. `X-Forwarded-For`, `X-Real-IP` and
 * similar headers are never consulted, because a client can send them. A value
 * that is missing or is not exactly one IP address lands in one shared bucket,
 * so sending junk can only ever share a budget, never earn a fresh one.
 *
 * This trusts Netlify to overwrite the header. A host that does not would let a
 * client choose its bucket, which is why no login decision rests on this alone:
 * the per-account limit does not depend on any header.
 */

export const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";

export const UNKNOWN_CLIENT = "client:unknown";

/** The eight groups of an IPv6 address, expanded. Assumes `isIP` already accepted it. */
function ipv6Groups(address: string): number[] {
  // The URL parser rewrites an embedded dotted IPv4 tail as hexadecimal groups.
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const [head = "", tail = ""] = canonical.split("::");
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

export function rateLimitClientKey(headers: Pick<Headers, "get"> | null | undefined): string {
  const value = headers?.get(NETLIFY_CLIENT_IP_HEADER)?.trim();
  if (!value) return UNKNOWN_CLIENT;

  const address = value.split("%")[0] ?? "";
  const version = isIP(address);
  if (version === 4) return `client:${address}`;
  if (version !== 6) return UNKNOWN_CLIENT;

  const groups = ipv6Groups(address);
  // An IPv4-mapped address is the same client as its IPv4 form.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return `client:${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  // One subscriber usually controls a whole /64, so a single address would be
  // free to rotate. The prefix is the unit that identifies them.
  return `client:${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}
