# ADR 0007: Transactional email

## Status

Accepted for Phase 7.

## Decision

Resend sends two transactional emails, composed with React Email: a studio
inquiry notification and a customer acknowledgment. No other message type
exists. Marketing, status-change, quote, booking, and reminder emails are out of
scope, and no webhook, queue, worker, or scheduler is introduced.

Persistence and delivery are separated absolutely. The Customer and Inquiry are
committed by the Phase 6 transaction, and only then is email attempted. No
provider call, template render, or other network I/O happens inside that
transaction, and no email failure can roll it back. A Resend outage costs the
studio a notification, never a lead, and the visitor is never told a stored
inquiry failed. The public success state remains CRM persistence and makes no
promise about email.

Both messages are built from the Inquiry snapshot. The acknowledgment is
addressed to `Inquiry.emailSnapshot` rather than the mutable `Customer.email`,
so it always matches the exact submission, and the notification reports what was
submitted even after an administrator edits the customer record.

Delivery is claimed by *creating* the `EmailDelivery` row, under a unique
constraint on `(inquiryId, type)`. Winning that insert is what grants the right
to call the provider, so a replayed submission, a double click, or two
concurrent requests cannot produce a second send. A manual retry claims by
conditional update instead, taking only a `FAILED`, `SKIPPED`, or
stale-`PROCESSING` row, so an already-accepted message can never be resent.
Resend's `Idempotency-Key` is sent as a second line of defence, scoped to the
attempt so deliberate retries still send while accidental duplicates of one
attempt collapse provider-side.

`ACCEPTED` means the provider accepted the API request and returned a message
id. It is deliberately not called `SENT` or `DELIVERED`: without webhooks the
application has no evidence a message reached an inbox, and the admin UI says
"Accepted by the email provider" for the same reason.

Configuration is environment-only — `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`, and `EMAIL_ADMIN_RECIPIENTS`. Secrets never live in the CMS,
the database, or an admin form, and no sender or recipient is hardcoded. An
empty configuration is a supported state: local development and tests run
without a key, and deliveries are recorded `SKIPPED` rather than pretending to
have been sent. A partial configuration is treated as a misconfiguration and
warned about once in production, naming variables only.

No rendered subject, HTML, or text is stored. The Inquiry snapshot already holds
everything the templates need, so storing the message again would only duplicate
personal data. Only a short sanitized error category is persisted; raw provider
responses are neither stored nor logged, and audit metadata carries an inquiry
id, a delivery type, and a status — never a recipient, body, or provider
payload. Initial delivery is attributed to no actor, using the existing public
semantics rather than inventing an administrator; manual retries record the real
one. Retrying is available to `EDITOR` and above, matching the rest of the CRM.

## Consequences and honest limits

Exactly-once external delivery is not claimed. The residual window is a process
dying between claiming a delivery and recording its outcome: the row stays
`PROCESSING` and is recoverable only after the five-minute stale threshold.
Recovery reuses that attempt's idempotency key, allowing Resend to return the
original result during its 24-hour retention window; after that window a
duplicate remains possible. A definite `FAILED` or `SKIPPED` result increments
the attempt and uses a new key so a genuine retry can send.

The installed Resend SDK accepts no `AbortSignal` and no timeout. Racing a timer
against the call was rejected: it would abandon the caller without cancelling
the request, turning an accepted message into an apparent failure and making the
duplicate case above more likely rather than less. Provider calls are therefore
bounded by the platform's own function timeout, and a delivery stranded that way
is recovered through the stale-claim path.

Delivery is awaited inside the public Server Action rather than deferred.
Serverless invocations may be frozen immediately after a response, so an
unawaited promise, `setTimeout`, or in-memory queue would silently lose
attempts; correctness is preferred to shaving that latency. A transactional
outbox drained by a scheduled worker would remove both this cost and the
stranded-`PROCESSING` window, and remains available if delivery volume or
latency ever justifies the infrastructure.

Bot protection, rate limiting, and GDPR retention and deletion of these records
remain Phase 8.
