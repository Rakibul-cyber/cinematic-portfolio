# Cinematic Portfolio

A premium portfolio and studio-management platform for a professional
photographer/videographer. The product will combine an image-led public website
with a private content-management system, media library, and lightweight
inquiry/customer workflow.

## Product overview

The public experience will present projects, galleries, services, testimonials,
studio information, and a secure inquiry flow. The private admin experience will
manage that content, optimized website media, customer inquiries, site settings,
and SEO data.

The product is planned as one Next.js application with clear public, admin,
server, and data-access boundaries. See [Architecture](docs/ARCHITECTURE.md) and
[ADR 0001](docs/DECISIONS/0001-stack.md) for the approved direction.

## Technology direction

- Next.js 15 App Router, React, strict TypeScript, and Tailwind CSS v4
- Next.js Server Actions and Route Handlers
- PostgreSQL on Neon through Prisma
- Better Auth for authentication and authorization foundations
- Cloudflare R2 for optimized website media and YouTube for long-form video
- Resend, Cloudflare Turnstile, Umami, Sentry, and free-compatible monitoring
- Netlify Free for production hosting and GitHub Actions for CI

Services are introduced only in the phase that needs them. The MVP follows a
free-first infrastructure policy; no paid service is added without a demonstrated
need and explicit approval.

## Development status

**Current phase: Phase 3 — Media System.**

Phase 1 delivered the frontend foundation: a responsive public shell,
centralized placeholder content, reusable UI primitives, local
application-served typography, reduced-motion-aware transitions, and a cinematic
placeholder homepage.

Phase 2 adds the persistence and authentication foundation: Neon PostgreSQL
through Prisma, Better Auth email/password sign-in for administrators, the
`SUPER_ADMIN` / `ADMIN` / `EDITOR` role model, server-side authorization
helpers, a protected minimal admin shell at `/admin`, and the audit log
foundation. There is no public sign-up, and content management does not exist
yet. See [ADR 0002](docs/DECISIONS/0002-auth-database-foundation.md) for the
decisions behind it, and the [roadmap](docs/ROADMAP.md) for phase boundaries.

Phase 3 adds authenticated image upload, metadata-free responsive WebP
processing, Cloudflare R2 storage, a PostgreSQL media catalogue, deletion, and
audit events. It does not add project or other Phase 4 CMS entities.

## Local development

Install the pinned dependencies. `postinstall` generates the Prisma Client, so
this step needs `prisma/schema.prisma` but no database connection:

```powershell
npm install
```

Configure the environment before starting the application — from Phase 2 the app
does not boot without a database and an auth secret. See
[Environment setup](#environment-setup) below, then:

```powershell
npm run dev
```

Then open `http://localhost:3000` for the public site, or
`http://localhost:3000/admin` for the admin area. Before proposing changes, run
the available quality checks:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Before contributing, read [Development](docs/DEVELOPMENT.md). Useful initial
checks are:

```powershell
git status
git branch --show-current
git remote -v
```

## Environment setup

Secrets live in `.env.local`, which is git-ignored. `.env.example` is the
committed contract and holds variable names and documentation only — never
values. Never expose a connection string or an auth secret through a
`NEXT_PUBLIC_` variable.

### Neon PostgreSQL

1. Open the [Neon console](https://console.neon.tech) and select your project.
2. Open **Dashboard → Connect to your database** (the **Connect** button).
3. Copy the **pooled** connection string — its host contains `-pooler` — into
   `DATABASE_URL` in `.env.local`.
4. Switch the same dialog's connection-type selector to the **direct**
   (unpooled) string and copy it into `DATABASE_URL_UNPOOLED`.

Paste both values straight into `.env.local`. Do not paste them into a chat,
an issue, a commit, or a support ticket.

The two strings are not interchangeable. The application uses the pooled
endpoint through Prisma's Neon driver adapter; Prisma Migrate uses the direct
endpoint, because PgBouncer in transaction mode cannot serve the session-level
statements migrations require.

If you use the Neon CLI, `neon.ts` in the repository root describes the branch
policy and the CLI writes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and
`NEON_BRANCH` into `.env.local` for you.

### Authentication

Generate a unique high-entropy secret per environment and put it in
`BETTER_AUTH_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set `BETTER_AUTH_URL` to the application's absolute origin —
`http://localhost:3000` for local development. Production values belong in the
deployment platform, not in the repository.

### Cloudflare R2 media

Use a dedicated development bucket (recommended
`cinematic-portfolio-media-dev`) and a bucket-scoped Object Read & Write API
token. Put `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`, and the public-read origin `R2_PUBLIC_BASE_URL` in
`.env.local`. Credentials remain server-only.

The library at `/admin/media` accepts JPEG, PNG, and WebP images up to 15 MB and
12,000 pixels per dimension. Uploads become metadata-free WebP: a master capped
at 2560px plus useful 320, 640, 1280, and 1920px widths without upscaling. Keys
are collision-safe and filename-independent. Deletion removes R2 objects before
database metadata; future CMS references must block direct deletion.
Replacements use new identities rather than overwriting cached keys. See
[ADR 0003](docs/DECISIONS/0003-media-storage.md).

## Database workflow

Prisma is configured through `prisma.config.ts`, which loads `.env.local` and
points the CLI at the direct connection.

```powershell
npm run db:generate        # regenerate the Prisma Client
npm run db:migrate         # create and apply a development migration
npm run db:migrate:status  # compare migration history with the database
npm run db:migrate:deploy  # apply committed migrations (deployment)
npm run db:studio          # browse data locally
```

Migrations are the only supported way to change the schema; `prisma db push` is
not used. Migration history under `prisma/migrations/` is committed, and an
already-applied migration is never edited — add a new one instead.

The generated client in `src/generated/` is git-ignored and rebuilt by
`postinstall`.

## First administrator

There is no public sign-up. Better Auth's registration endpoint is disabled, so
the first `SUPER_ADMIN` is created by a local script that never accepts a
password from the command line or from source.

Set the password in your shell for this one command, then run the script:

```powershell
$env:ADMIN_BOOTSTRAP_PASSWORD = "<a strong unique password, 12+ characters>"
npm run admin:bootstrap -- --email "you@example.com" --name "Your Name"
Remove-Item Env:\ADMIN_BOOTSTRAP_PASSWORD
```

`--role` defaults to `SUPER_ADMIN` and also accepts `ADMIN` or `EDITOR`. The
script refuses an email that already exists and does not reset passwords.
Hashing is performed by Better Auth; the password is never logged, printed, or
written to the audit trail.

Then sign in at `http://localhost:3000/admin/login`.

## Verifying authentication

Pure authorization logic (the role hierarchy and redirect-target validation) is
covered by Node's built-in test runner:

```powershell
npm test
```

Behaviour that only exists over HTTP — route protection, session cookies,
sign-out, and session invalidation — is checked against a running application:

```powershell
npm run build
npx next start
# in a second terminal, using an account created above:
$env:ADMIN_TEST_EMAIL = "you@example.com"
$env:ADMIN_TEST_PASSWORD = "<that account's password>"
npm run auth:verify
Remove-Item Env:\ADMIN_TEST_PASSWORD
```

## Admin routes

| Route | Access |
| --- | --- |
| `/admin/login` | Public. Redirects to `/admin` when already signed in. |
| `/admin` | Requires a valid session. Redirects to `/admin/login` otherwise. |
| `/api/auth/*` | Better Auth endpoints. Sign-up is disabled. |

Middleware redirects visitors without a session cookie for routing convenience
only; it verifies nothing. Every protected page and mutation enforces
authentication and role requirements on the server through the helpers in
`src/server/auth/session.ts`.

## Repository rules

- Work phase by phase and do not begin the next phase without approval.
- Keep secrets in local environment files; commit only `.env.example`.
- Do not commit dependencies, generated builds, logs, or credentials.
- Use conventional commits and review the full diff before committing.
- Do not rewrite Git history, force-push, or push without explicit approval.
- Record meaningful architectural decisions under `docs/DECISIONS/`.
