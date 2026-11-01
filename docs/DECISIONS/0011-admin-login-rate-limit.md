# ADR 0011: Administrator sign-in rate limit

## Status

Accepted. Not yet deployed.

## Context

Better Auth 1.7.3 enables its limiter in production, allowing 3 sign-in requests
per 10 seconds per address. That left three gaps. The limiter runs only in the
HTTP router's `onRequest`, and the admin form signs in through a Server Action
calling `auth.api.signInEmail`, which never reaches it. Its default storage is
per-process memory, so each Netlify function instance counts separately. It has
no per-account limit. Its `database` storage needs a new `rateLimit` table, and
its `customStorage` would still not see the Server Action or the account.

## Decision

One `hooks.before` middleware, `createLoginGuard`, runs on `/sign-in/email`.
Better Auth runs that hook for direct `auth.api` calls and HTTP requests alike,
ahead of the password check, so there is one enforcement point and no second
sign-in path to protect. The HTTP endpoint stays open and is covered.

Counters reuse `rate_limit_bucket` and its atomic upsert, so no migration or new
infrastructure is needed. Keys are HMACs under `RATE_LIMIT_HMAC_SECRET`, in scopes
separate from inquiries.

- **Account:** 6 attempts per fixed 15-minute window. It uses no request header,
  so it holds against distributed attempts and spoofed addresses.
- **Client:** 20 attempts per fixed 15-minute window, from
  `x-nf-client-connection-ip` only. IPv6 counts by /64. A missing or malformed
  value shares one bucket.

Every attempt counts before the password is checked, for known and unknown
accounts alike. A concurrent burst therefore cannot pass the limit, and being
throttled reveals nothing about an account. Successful sign-ins count too, and
are not refunded: refunding would need a second write and would let an attacker
holding one valid password probe others.

Fixed windows make every block end at the window boundary, however long attempts
continue, so there is no permanent lockout. Better Auth's memory limiter stays on
for the HTTP route as a cheap first layer, now reading the same trusted header.

Sign-in fails closed. Without a usable secret or storage the guard refuses with
503 before any password check, because an unlimited login is worse than a brief
outage of a private area, and the same database holds the accounts anyway.

Each refusal writes one log line with a fixed category and no identifiers. A
limit is audited once per window, not once per attempt, so a flood cannot flood
the audit table.

## Limits

An attacker who knows the administrator's email can keep that account blocked by
spending 7 requests per window. That trades availability for password safety, and
only a second factor or a trusted-device exemption removes it.

Fixed windows allow up to twice the limit across a boundary. Attempts distributed
across many addresses and many emails have no global ceiling: they cannot target
one account beyond its limit, but they do still cost password hashing.

The client limit trusts Netlify to overwrite its header, which has not been tested
against a live deployment. If it does not, the client limit can be evaded, while
the account limit is unaffected.
