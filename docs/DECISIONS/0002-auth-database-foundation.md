# ADR 0002: Database and Authentication Foundation

- **Status:** Accepted
- **Date:** 2026-09-07
- **Decision owners:** Project owner and implementation team

## Context

[ADR 0001](0001-stack.md) approved PostgreSQL on Neon through Prisma, with
Better Auth for authentication. Phase 2 turns that direction into working
infrastructure and had to settle several concrete questions that the stack
decision left open:

- how a serverless-friendly Neon connection is configured under Prisma 7, which
  removed the bundled query engine in favour of driver adapters;
- how roles are modelled and where authorization is actually decided;
- how the first administrator is created without a public registration route;
- what the audit trail records before any admin feature exists.

The admin area is private. There is no customer-facing account system now or
planned, so nothing here needs to accommodate self-service registration.

## Decisions

### Two connection strings, split by purpose

`DATABASE_URL` holds Neon's **pooled** endpoint and is used by the running
application. `DATABASE_URL_UNPOOLED` holds the **direct** endpoint and is used
only by Prisma Migrate, configured through `prisma.config.ts`.

Prisma Migrate issues session-level statements and holds advisory locks across
statements, which PgBouncer in transaction pooling mode cannot serve. Splitting
the two endpoints keeps application connections pooled — which matters for
short-lived serverless invocations — without breaking migrations.

Neon's own variable names are used rather than Prisma's documented `DIRECT_URL`,
because the Neon CLI writes `DATABASE_URL_UNPOOLED` into `.env.local`. Renaming
it would mean re-editing generated configuration on every branch switch.

### Prisma 7 with the Neon driver adapter

Prisma 7 requires a driver adapter. `@prisma/adapter-neon` (over
`@neondatabase/serverless`) is used rather than `@prisma/adapter-pg`, matching
Neon's and Prisma's joint recommendation and suiting a serverless host.

`prisma` and `@prisma/client` are pinned to exactly `7.10.0`. At the time of
writing the `prisma` package's `latest` dist-tag points at `8.0.0-rc.13` while
`@prisma/client` resolves to `7.10.0`; installing "latest" would silently pair a
release-candidate CLI with a stable client.

The generated client is written to `src/generated/prisma`, git-ignored, and
recreated by a `postinstall` hook. Generated code is not reviewed source.

### Roles are a database enum, checked server-side against the database

`AdminRole` is a PostgreSQL enum with `SUPER_ADMIN`, `ADMIN`, and `EDITOR`, and
lives on the user row. Better Auth declares it as an additional user field with
`input: false`, so it can never be supplied or escalated through the auth API.

Phase 2 implements an **ordered hierarchy** (`roleAtLeast`), not a permissions
engine. `SUPER_ADMIN` satisfies any requirement, `ADMIN` satisfies `EDITOR`.
Feature-level permissions are introduced with the features that need them.

`getCurrentUser()` re-reads the user row from PostgreSQL on each request rather
than trusting the role carried in the session payload. This costs one indexed
primary-key lookup and buys a single authoritative source: a role change or a
deleted account takes effect on the next request instead of when the session
expires. For an admin area with a handful of users this is the right trade.

Session cookie caching is disabled for the same reason — the session row is
read from the database on every request, so revocation is immediate.

### Middleware routes; pages authorize

`src/middleware.ts` checks only whether a session cookie is *present*, to avoid
rendering a protected route for an obviously anonymous visitor and to preserve
the requested path in a `next` parameter. It runs on the Edge runtime and cannot
reach the database, so it verifies nothing.

Authorization is decided exclusively by `requireUser` / `requireRole` /
`requireAdmin`, which validate the session against PostgreSQL inside the page,
Server Action, or Route Handler. A forged cookie therefore passes the middleware
and is still rejected — this is covered by an explicit check in
`scripts/verify-auth-flow.mjs`.

The `next` parameter is attacker-controlled, so `isSafeInternalPath` restricts
redirect targets to paths inside `/admin`, closing the open-redirect path.

### The first administrator is created by a local script

`emailAndPassword.disableSignUp` is `true`, which closes Better Auth's sign-up
endpoint **and** the equivalent server API. There is no registration route to
attack, and no anonymous visitor can provision an account.

`scripts/bootstrap-admin.ts` therefore hashes the password with Better Auth's
own configured hasher (obtained from `auth.$context`) and writes the user row
and its `credential` account together in one transaction. The password is read
from `ADMIN_BOOTSTRAP_PASSWORD` in the operator's shell — never from a
command-line argument, which would land in shell history, and never from source.

The alternative, temporarily re-enabling sign-up to create the account, was
rejected: a security control that gets switched off during setup is a control
that eventually stays off.

### Audit log foundation

One `audit_log` table records `action`, `entityType`, `entityId`, `actorUserId`,
`actorEmail`, `metadata`, and `createdAt`. Sign-in, failed sign-in, sign-out, and
administrator bootstrap are recorded now; later phases add their own actions.

`actorUserId` is nullable with `ON DELETE SET NULL`, and `actorEmail` is stored
alongside it, so the trail survives account deletion and stays readable.
`metadata` is `Json` because entries describe heterogeneous actions across
features that do not exist yet; relational modelling would be premature and
would need reshaping with every new action. It must never carry credentials,
tokens, secrets, or connection strings.

A failed audit write is reported and swallowed rather than failing the action
being audited. This is acceptable for a foundation; if auditing later becomes a
compliance guarantee it needs a durable outbox instead.

### Route groups separate public and admin shells

The Phase 1 root layout applied the cinematic header and footer to everything.
Those moved into a `(public)` route group so `(admin)` can render its own quiet
shell, as anticipated by `docs/ARCHITECTURE.md`. The root layout now owns only
`<html>`, `<body>`, fonts, and global CSS. No Phase 1 component changed.

### Server-only boundaries are enforced by the compiler

`src/server/**` modules import `server-only`, so an accidental import from a
Client Component fails the build instead of leaking a credential. Consequently
those modules cannot be loaded by plain Node; the bootstrap script runs with
`--conditions=react-server`, which resolves the marker to a no-op.

Pure route logic that both the browser and the server need (`admin-routes.ts`)
is deliberately kept free of both `server-only` and Next.js imports, which also
keeps it directly unit-testable.

### Testing without a testing stack

Phase 2 adds no test framework. Pure authorization logic is covered by
`node:test` (built in, run through the `tsx` already needed for the bootstrap
script). The behaviour that only exists over HTTP — route protection, cookies,
sign-out, database-backed session invalidation — is covered by
`scripts/verify-auth-flow.mjs`, which uses only Node's `fetch` against a running
application. A real framework can be introduced when component and E2E tests
justify it.

## Consequences

### Benefits

- Migrations and application traffic each use the connection type they need.
- Authorization has one server-side chokepoint and one authoritative source.
- No registration surface exists to attack, and no setup step weakens one.
- The audit trail survives user deletion and is ready for admin features.
- Server-only leaks fail at build time rather than in production.

### Tradeoffs

- Every protected request costs one extra indexed lookup for the role, and
  disabled cookie caching means a session read per request. Deliberate, and
  revisitable if measurement shows it matters.
- Pinning Prisma to `7.10.0` means upgrades are a conscious step, which is the
  point while the `latest` tag is unreliable.
- Cold production builds emit a warning that `jose` uses
  `CompressionStream`/`DecompressionStream`, which the Edge runtime lacks. It
  arrives through `better-auth/cookies` in middleware, belongs to the JWE code
  path that `getSessionCookie` never reaches, and does not fail the build.
  Setting `runtime: "nodejs"` on the middleware removes it and was verified to
  build cleanly, but Edge is kept until Netlify support for Node.js middleware
  is confirmed in Phase 10.
- `ADMIN_BOOTSTRAP_PASSWORD` puts a password in the operator's environment for
  the duration of one command. Documented as such, with instructions to clear
  it afterwards.

## Reconsideration triggers

Revisit if measured request latency makes the per-request role lookup
significant, if the role hierarchy stops expressing real permission needs (at
which point a capability model replaces it, not a longer enum), if auditing
becomes a compliance guarantee requiring delivery assurance, or if administrator
count grows enough that accounts need to be managed through the admin UI rather
than a local script.
