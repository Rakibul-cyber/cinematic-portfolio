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

**Current phase: Phase 5 — Public Portfolio.**

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

Phase 4 adds a focused private CMS for projects, categories, project media,
services, testimonials, stable page copy, site settings, social links, and basic
SEO fields.

Phase 5 connects that CMS to the public site: a CMS-backed homepage, a work
index with category filtering, project detail pages with ordered galleries,
Services, About, and a presentation-only Contact page, responsive R2 image
delivery, and a privacy-enhanced click-to-load video player. Inquiry
submission, email, analytics, and the full SEO system remain later phases. See
[ADR 0005](docs/DECISIONS/0005-public-portfolio.md).

Phase 6 adds a real inquiry form and a deliberately small internal CRM.
Customers are conservatively matched by normalized email while each inquiry
retains the visitor's original snapshot. Editors can review the pipeline,
update customer details, and append internal notes; ADMIN and SUPER_ADMIN can
export formula-safe CSV. No email is sent until Phase 7. See
[ADR 0006](docs/DECISIONS/0006-inquiry-crm.md).

Phase 7 adds transactional email through Resend and React Email: a studio
inquiry notification and a customer acknowledgment, both built from the Inquiry
snapshot. The inquiry is committed before any provider call, so an email
failure never affects a stored inquiry or the visitor's success state. Delivery
state is persisted per inquiry and email type, replays cannot resend, and
administrators can retry a failed send from the inquiry page. See
[ADR 0007](docs/DECISIONS/0007-transactional-email.md).

Phase 8 adds server-verified Turnstile on the inquiry form, durable pseudonymous
rate limits, application-specific security headers, and SUPER_ADMIN customer
export/anonymization operations. These are GDPR-conscious operational controls,
not legal certification. See
[ADR 0008](docs/DECISIONS/0008-security-privacy.md).

## Public site

| Route | Content |
| --- | --- |
| `/` | Hero, selected work, showreel, services, studio statement, testimonials, contact invitation. |
| `/work` | Published projects, filterable by active category via `?category=<slug>`. |
| `/work/<slug>` | One published project: cover, details, description, optional film, ordered gallery. |
| `/services` | Active services in configured order, with the studio's own price labels. |
| `/about` | The CMS About page plus studio settings. |
| `/contact` | Contact details, social links, and the validated inquiry form. |

### How content reaches the public site

The CMS is the source of truth. `src/content/site.ts` holds interface chrome
only — navigation targets, section labels, and neutral wording for an empty
CMS. It contains no studio, client, project, or price content.

`src/server/public/` is the only place public pages read the database. It
applies the publication filters, then maps rows into explicit view models, so
components never see Prisma rows and internal columns cannot reach public HTML.

Publication rules, enforced in the query rather than the UI:

| Entity | Public when |
| --- | --- |
| Project | `status` is `PUBLISHED` **and** its category is active |
| Category | active **and** it contains published work |
| Service, testimonial, social link | active |
| Page (`about`, `contact`, `services`) | always, if saved |

A draft project and a slug that never existed both return a normal 404. Nothing
indicates that a draft exists.

Sections with no content are omitted rather than filled: no services means no
services section, no testimonials means no testimonial block, no showreel video
means no showreel. Visitors never see administrative wording.

To publish work, an editor creates a category, uploads media at
`/admin/media` with alt text, creates a project at `/admin/projects`, selects
its media in order (the first selection is the cover), sets the status to
`PUBLISHED`, and saves. The change appears on the public site immediately —
each mutation invalidates the public cache tags and routes it affects.

### Caching

Public reads are cached and tagged per entity; admin saves call
`revalidatePublicContent`, which purges the affected tags and routes. A
one-hour `revalidate` bounds staleness if an invalidation is ever missed.
`/`, `/about`, `/services`, and `/contact` are statically rendered with ISR;
`/work/<slug>` is pre-rendered for published slugs and renders newly published
work on demand; `/work` is per-request because of its category filter.

Do not add a `loading.tsx` to the public route group: a streaming boundary
commits HTTP 200 before `notFound()` runs and turns draft URLs into soft 404s.

### Images and video

Public images are the Phase 3 R2 variants served directly through `srcset`,
sized by layout, with intrinsic dimensions and the tiny blur placeholder to
prevent layout shift. The 2560 master is never served when a smaller variant
covers the layout. URLs are built only from `R2_PUBLIC_BASE_URL`, so no bucket
name or host appears in a component.

Long-form video stays with a video provider. Administrators enter a provider
and that provider's video ID only — never a URL or embed code — for a project
film (`/admin/projects`) or the homepage showreel (`/admin/settings`). The
player requests nothing from the provider until a visitor presses play, and
YouTube is embedded through `youtube-nocookie.com`.

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

### Transactional email

Set `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_ADMIN_RECIPIENTS` in
`.env.local`, plus the optional `EMAIL_REPLY_TO`. `EMAIL_FROM` must be on a
domain verified in Resend, and `EMAIL_ADMIN_RECIPIENTS` is a comma-separated
list where every entry must be valid.

Leaving all of them empty is supported and is the normal local setup: inquiries
are still stored, the public form still succeeds, and each delivery is recorded
as `SKIPPED` rather than pretending a message was sent. Setting some but not all
is treated as a misconfiguration and warned about once in production, naming
variables only. The API key is server-only and must never reach a
`NEXT_PUBLIC_` variable, the CMS, or the database.

Two emails are sent per inquiry — a studio notification and a customer
acknowledgment — both built from the Inquiry snapshot, with the acknowledgment
addressed to the exact submitted address. `ACCEPTED` in the admin UI means the
provider accepted the request, which is not proof of inbox delivery; there is no
webhook tracking. See [ADR 0007](docs/DECISIONS/0007-transactional-email.md).

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
| `/admin/projects` | Project CRUD, publishing, and ordered media assignment. |
| `/admin/categories` | Ordered portfolio category management. |
| `/admin/media` | Media management with project-reference protection. |
| `/admin/services` | Ordered service and display-price management. |
| `/admin/testimonials` | Ordered testimonial management. |
| `/admin/pages` | Stable About, Contact, and Services copy. |
| `/admin/settings` | ADMIN+ global settings and social links. |
| `/admin/inquiries` | Searchable, status-filtered and paginated inquiry pipeline. |
| `/admin/inquiries/export` | ADMIN+ CSV export. Other signed-in roles receive 403. |
| `/admin/customers` | Searchable customer records, inquiry history and internal notes. |
| `/admin/inquiries/<id>` | Inquiry snapshot, status pipeline, and transactional email state with retry. |
| `/api/auth/*` | Better Auth endpoints. Sign-up is disabled. |

Middleware redirects visitors without a session cookie for routing convenience
only; it verifies nothing. Every protected page and mutation enforces
authentication and role requirements on the server through the helpers in
`src/server/auth/session.ts`.

Editors may create and edit CMS content and manage project-media relationships.
Destructive operations and global settings require `ADMIN` or `SUPER_ADMIN`.
Projects use only draft/published states. Deleting a project preserves its media;
referenced media must be detached before deletion. See
[ADR 0004](docs/DECISIONS/0004-admin-cms.md).

## Verifying the public site

Pure rules — publication filters, view-model mapping, responsive source
selection, video privacy, and metadata fallbacks — run under `npm test`.

Behaviour that only exists over HTTP is checked against a running application.
The script creates temporary CMS content and real media, asserts the public
rendering, then removes everything and restores the previous settings and
pages:

```powershell
npm run public:verify -- --seed
npm run build
npx next start
# in a second terminal:
npm run public:verify -- --check
npm run public:verify -- --cleanup
```

Seed before building: the build renders the public pages, so it must see the
seeded content.

## Repository rules

- Work phase by phase and do not begin the next phase without approval.
- Keep secrets in local environment files; commit only `.env.example`.
- Do not commit dependencies, generated builds, logs, or credentials.
- Use conventional commits and review the full diff before committing.
- Do not rewrite Git history, force-push, or push without explicit approval.
- Record meaningful architectural decisions under `docs/DECISIONS/`.
