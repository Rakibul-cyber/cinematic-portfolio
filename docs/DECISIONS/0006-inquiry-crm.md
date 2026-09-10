# ADR 0006: Small inquiry and customer CRM

## Status

Accepted for Phase 6.

## Decision

The public contact page submits a validated Server Action. It stores an immutable
snapshot of the visitor's fields on `Inquiry` while associating the submission
with a reusable `Customer`. Customer identity is the trimmed, lower-cased email
only; provider-specific dot or alias rewriting and name/phone matching are not
used. A unique constraint, serializable transaction, atomic upsert, and bounded
retry make concurrent matching safe. The retry covers both `P2034` serialization
conflicts and the `P2002` unique violation on `normalizedEmail` that a concurrent
first-time submission can raise; a `P2002` on `submissionToken` is not retried
but resolved to the inquiry the first attempt already created.

`Inquiry` rows are immutable historical submissions. Nothing outside the
submission itself ever rewrites a snapshot, so an inquiry always shows what the
visitor actually sent, however the customer record or the referenced service
changes afterwards.

A later inquiry from a known email never overwrites an existing non-empty
`Customer` field. `normalizedEmail` is assigned once at creation and is never
reassigned by a submission, and the current `email`, `name`, `phone`, `whatsapp`,
and `company` an administrator curates are left intact. A submission may only
fill those contact fields while they are still blank, which adds information
without discarding any. Administrators change current customer details through
`/admin/customers`, which is the single place that value is authored; the
visitor's own wording always survives on the inquiry snapshot regardless.

An opaque client-generated submission token is unique on `Inquiry`, making a
double click or browser retry idempotent without blocking later legitimate
inquiries. A hidden honeypot provides a modest no-dependency spam boundary;
Turnstile and production abuse controls remain Phase 8.

The pipeline is `NEW`, `CONTACTED`, `DISCUSSION`, `QUOTE_SENT`, `CONFIRMED`,
`IN_PROGRESS`, `COMPLETED`, and `CANCELLED`. Transitions have dedicated history;
customer notes are append-only and internal. CRM records have no ordinary delete
UI. Editors operate the CRM; CSV export requires ADMIN. Formula-leading CSV
cells are neutralized. No inquiry PII is placed in audit metadata, URLs, or logs.

Preferred project dates are PostgreSQL `DATE` values, representing calendar
dates rather than instants. Inquiry snapshots do not change when current customer
data or a related service changes. Email remains Phase 7; stronger anti-spam,
retention, and GDPR workflows remain Phase 8.
