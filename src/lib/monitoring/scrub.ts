import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Defensive redaction applied to everything the SDK is about to send.
 *
 * The SDK's own `dataCollection` settings already switch off the structured
 * carriers of personal data — cookies, headers, bodies, query parameters, user
 * info, and local variables (see `options.ts`). This module is the second
 * layer, for the places personal data arrives as free text: a library that
 * interpolates the value that failed into its message, or an application error
 * that names the address it could not deliver to.
 *
 * Honest limitation: this is pattern matching, not a proof. A stack trace or an
 * error message can contain a string no pattern here recognizes — an unusual
 * address format, a name, a fragment of an inquiry message. What this does is
 * remove the predictable carriers and shrink the residual risk; it cannot
 * guarantee that no personal data ever reaches Sentry. The structural controls
 * in `options.ts` are the primary defence, and this is the backstop. That
 * residual limitation is recorded in ADR 0009.
 */

/** Redacts predictable carriers of personal data from free text. */
export function scrubText(value: string): string {
  return (
    value
      // Credentials embedded in a URL, including connection strings.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]*@/gi, "$1[redacted]@")
      // Email addresses.
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
      // Bearer tokens, API keys, passwords, and Turnstile tokens.
      .replace(
        /\b(bearer|token|key|secret|password)[=:\s]+\S+/gi,
        "$1=[redacted]",
      )
      // Query strings, which carry submitted values.
      .replace(/\?[^\s"']{3,}/g, "?[redacted]")
      // Runs of digits long enough to be a phone or account number.
      .replace(/\+?\d[\d\s()-]{8,}\d/g, "[redacted-number]")
  );
}

/** Reduces a URL to its origin and path, dropping query and fragment. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value);

    return `${url.origin}${url.pathname}`;
  } catch {
    return scrubText(value.split(/[?#]/, 1)[0]);
  }
}

/**
 * Final pass over an outgoing error event.
 *
 * Deletes the structured carriers outright rather than trusting configuration
 * alone — the SDK's request-data handling has changed shape between major
 * versions, and an event that reaches Sentry cannot be recalled.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Never identify anyone, even by IP or by an id another integration set.
  delete event.user;

  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;

    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
  }

  if (event.message) {
    event.message = scrubText(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = scrubText(exception.value);
    }
  }

  // `captureRequestError` records the request path, which may carry a query.
  const nextjs = event.contexts?.nextjs as
    | { request_path?: unknown }
    | undefined;

  if (nextjs && typeof nextjs.request_path === "string") {
    nextjs.request_path = scrubUrl(nextjs.request_path);
  }

  return event;
}

/**
 * Filters and redacts breadcrumbs.
 *
 * Console breadcrumbs are dropped entirely: this application logs the values it
 * is working with, and a breadcrumb trail of its own logs is the most likely
 * way an inquiry detail would reach an error report. Navigation and request
 * breadcrumbs are kept — they are what makes a report diagnosable — with their
 * URLs reduced to origin and path.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;

  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = scrubText(breadcrumb.message);
  }

  const data = breadcrumb.data;

  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") {
        data[key] = scrubUrl(data[key]);
      }
    }
  }

  return breadcrumb;
}
