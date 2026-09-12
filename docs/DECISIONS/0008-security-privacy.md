# ADR 0008: Security and privacy hardening

## Status

Accepted for Phase 8.

## Decision

Public inquiries pass bounded validation, idempotent replay lookup, durable rate
limiting, and Cloudflare Turnstile before CRM persistence. Email remains strictly
post-commit. Turnstile uses the official verification endpoint; tokens and raw
responses are never stored or logged. Production fails closed without complete
configuration, while development deliberately bypasses only when both keys are
absent.

PostgreSQL fixed windows allow five attempts per ten minutes and twenty per day.
A dedicated server-only HMAC secret pseudonymizes keys. On Netlify only the
platform-owned `x-nf-client-connection-ip` is used; `X-Forwarded-For` is never
trusted. Without the Netlify header the limiter layers normalized-email and
submission-token keys, a useful but weaker fallback. Another host needs an
equally trusted client-IP adapter. Expired buckets are removed opportunistically;
no cron, Redis, fingerprint, user agent, or raw IP storage is introduced.

Application-specific security headers allow local assets, the configured R2
image origin, Turnstile, and click-to-load YouTube/Vimeo frames. Wildcard
defaults and frames are prohibited. Current Next.js hydration/generated styles
still require narrowly scoped `unsafe-inline`. Framing and plugins are disabled,
referrers are omitted, unused device capabilities are disabled, and production
adds one-year HSTS without subdomains or preload. Admin responses are private
and no-store. Better Auth retains HttpOnly, SameSite=Lax, production Secure
cookies, same-origin trust, database sessions, and an eight-hour lifetime.

SUPER_ADMIN can export one customer's data with no-store headers or anonymize
after typing `ANONYMIZE`. One transaction clears current identifiers, inquiry
snapshot identifiers/free text, and note bodies while retaining relations and
non-identifying operational history. `anonymizedAt` makes the operation
idempotent, blocks editing and email retry, and releases the former normalized
email so a later inquiry creates an active customer. Privacy audit metadata
contains IDs and operation names only; authenticated actor identity remains.

Anonymization is checked inside the delivery claim itself, so no email attempt
can start for an erased inquiry through either the administrator retry path or
the public idempotent replay path. Work that has already crossed the claim
boundary is not recalled: an initial send in flight when anonymization commits
may still reach the provider, exactly as an already-posted letter cannot be
retrieved. The guarantee this phase makes is therefore about future attempts,
not about in-flight ones.

Local anonymization does not reach the transactional email processor. A message
already handed to Resend may persist in provider logs and in the recipient's
mailbox, and neither is erased by anything in this repository. Provider-side
retention and deletion are governed by that account's configuration and by the
operator's processor agreements, so a privacy request may require separate
processor-side action. This workflow is local erasure, not erasure across all
processors.

No universal retention duration is encoded. The operator must establish one
with appropriate legal advice and periodically review old completed/cancelled
inquiries for deliberate export or anonymization. Audit retention is a separate
accountability policy. No analytics or marketing cookies exist, so no general
cookie banner is added. Turnstile loads only on the configured inquiry form;
video providers still load only after activation. Owner-reviewed Privacy Policy
and Impressum content remain required; no legal identity is fabricated.

## Limits

These are GDPR-conscious controls, not legal certification. Fixed windows are
simple, non-Netlify hosting needs trusted IP integration, CSP retains required
inline allowances, and retention review remains operational. Analytics,
monitoring, SEO, and deployment remain Phase 9 or later.
