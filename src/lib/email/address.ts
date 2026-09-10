/**
 * Email address and header helpers.
 *
 * Pure and free of `server-only` and provider imports so every rule here is
 * unit-testable without a database or a Resend key.
 *
 * Two concerns live together because they share one threat: values that reach
 * an email envelope must never carry a line break. Even though Resend is called
 * over JSON rather than SMTP, a newline in a subject or display name is treated
 * as untrusted here rather than trusting the provider to sanitize it.
 */

/** Characters that must never appear in a header value. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;
/** RFC address-list delimiters and quoting characters excluded from names. */
const DISPLAY_NAME_SYNTAX = /["<>(),:;@\\]/g;

/** Conservative address shape. Deliberately stricter than RFC 5322. */
const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type MailAddress = {
  /** Bare address, e.g. `studio@example.com`. */
  address: string;
  /** Optional display name, e.g. `Studio Name`. */
  name?: string;
};

/** True when `value` is a syntactically acceptable bare email address. */
export function isEmailAddress(value: string): boolean {
  // Control characters are rejected against the raw value, before trimming.
  // Trimming first would call an address ending in CRLF valid, and a caller
  // trusting that answer could then put the untrimmed value into a header.
  if (CONTROL_CHARACTERS.test(value)) return false;

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && ADDRESS.test(trimmed);
}

/**
 * Parses `Name <address@example.com>` or a bare address.
 *
 * Returns `null` for anything malformed, so a misconfigured sender fails
 * configuration validation rather than producing a broken envelope.
 */
export function parseMailAddress(value: string): MailAddress | null {
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 320 || CONTROL_CHARACTERS.test(raw)) {
    return null;
  }

  const angled = /^(.*)<([^<>]+)>$/.exec(raw);
  if (!angled) {
    return isEmailAddress(raw) ? { address: raw } : null;
  }

  const address = angled[2].trim();
  if (!isEmailAddress(address)) return null;

  // Address-list syntax is dropped rather than escaped: display names are
  // cosmetic, and a conservative safe subset cannot introduce another
  // mailbox when the provider parses the resulting string.
  const name = angled[1].trim().replace(DISPLAY_NAME_SYNTAX, "").trim();

  return name ? { address, name } : { address };
}

/**
 * Renders a `MailAddress` back into a provider-ready string.
 *
 * The display name is sanitized here rather than trusted. Names reaching this
 * function include the visitor's own submitted name, which validation bounds
 * but does not otherwise constrain — stripping control characters, quotes, and
 * angle brackets at the point of formatting means no submitted value can break
 * out of the envelope, whatever path it arrived by.
 */
export function formatMailAddress(value: MailAddress): string {
  if (!value.name) return value.address;

  const name = value.name
    .replace(CONTROL_CHARACTERS_GLOBAL, ' ')
    .replace(DISPLAY_NAME_SYNTAX, "")
    .replace(/\s+/g, ' ')
    .trim();

  return name ? `${name} <${value.address}>` : value.address;
}

/**
 * Parses a comma-separated recipient list.
 *
 * Every entry must be valid: a single typo is a configuration error worth
 * surfacing, not something to silently drop from the studio's notifications.
 * Duplicates are removed so one address is never mailed twice.
 */
export function parseMailAddressList(value: string): MailAddress[] | null {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) return null;

  const parsed: MailAddress[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const address = parseMailAddress(entry);
    if (!address) return null;

    const key = address.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(address);
  }

  return parsed;
}

/** Longest subject retained. Well under what mail clients display. */
export const MAX_SUBJECT_LENGTH = 120;

/**
 * Makes an arbitrary string safe to use as a subject.
 *
 * Line breaks and control characters are removed, runs of whitespace are
 * collapsed, and the result is truncated. Visitor-supplied values reach
 * subjects (a project type, for example), so this is a boundary control rather
 * than cosmetic tidying.
 */
export function sanitizeSubject(value: string): string {
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (collapsed.length <= MAX_SUBJECT_LENGTH) return collapsed;

  return `${collapsed.slice(0, MAX_SUBJECT_LENGTH - 1).trimEnd()}…`;
}
