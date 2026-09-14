# Architecture

## Purpose

Cinematic Portfolio is a single deployable web application for a professional
photography/video studio. It combines a premium public portfolio with an
authenticated admin CMS, optimized media management, SEO/content management,
and a lightweight inquiry/customer CRM.

This document records the approved system boundaries. Implementation details are
introduced only in their assigned roadmap phase.

## One-application architecture

One Next.js application owns the web UI and application backend:

```text
Browser
  |
  v
Next.js application
  |-- Public routes and components
  |-- Authenticated admin routes and components
  |-- Server Actions and Route Handlers
  |-- Authentication, authorization, validation, and business logic
  `-- Prisma data access
        |
        `-- PostgreSQL on Neon
```

There is no separate frontend/backend repository. Boundaries are enforced through
module ownership and server-only code, not separate deployments.

## Planned source organization

Phase 1 will establish a `src/`-based layout. The exact files may evolve with
implementation, but ownership should remain recognizable:

```text
src/
  app/          Route segments, layouts, pages, Route Handlers, and route-local UI
  components/   Shared public, admin, and low-level UI components
  lib/          Framework adapters, validation, configuration, and shared helpers
  server/       Server-only business workflows and data-access composition
```

Public and admin route groups may organize their own layouts without becoming
separate applications. Domain-specific code should stay close to its owner until
it is genuinely shared. Imports must make the server/client boundary explicit;
browser code cannot depend on database, authentication secrets, or service
credentials.

## Public and admin boundaries

### Public application

The public side is cinematic, editorial, responsive, accessible, and media-first.
Server Components are the default. Client Components are reserved for genuine
interaction such as navigation state, selective motion, gallery controls, forms,
and consent-aware video loading.

Public visitors may read published content and submit validated inquiries. They
must never receive unpublished content, administrative data, secrets, or internal
customer notes.

From Phase 5, all public database access goes through one server-side read layer
(`src/server/public/`) that applies the publication filters and maps rows into
explicit view models. Components never receive Prisma rows, so internal columns
cannot reach public HTML, and publication is enforced in the query rather than
by hiding content in the UI.

### Admin application

The admin area lives under `/admin` and prioritizes clarity, speed, accessibility,
and predictable workflows rather than the visual language of the public site.
Every protected page and mutation requires server-side authentication and
authorization. Client-side role checks may improve presentation but never grant
access.

Initial roles are `SUPER_ADMIN`, `ADMIN`, and `EDITOR`. Exact permissions will be
defined with the Phase 2 authorization foundation and expanded alongside admin
features.

## Server-side architecture

- Server Components read data needed for rendering whenever practical.
- Server Actions handle mutations naturally initiated by the application UI.
- Route Handlers provide HTTP endpoints where an explicit request/response
  boundary is appropriate, including service callbacks and upload flows.
- Zod validates all untrusted input at server boundaries.
- Business rules remain separate from route rendering and transport details.
- Prisma is the only planned application data-access layer for PostgreSQL.
- Secrets remain in server-only modules and non-public environment variables.

The domain will grow deliberately. Expected entities include users and roles,
projects and categories, media, services, inquiries and customers, testimonials,
pages/settings, SEO data, and audit logs. They are not created during Phase 0.

## Transactional email

Email is a side effect of persistence, never a participant in it. The CRM
transaction commits first; delivery is attempted afterwards, outside any
transaction, and no provider failure can roll back or hide a stored inquiry.

One provider (Resend) is reached through a single small sender interface, so
nothing above that boundary imports the SDK and a provider change touches one
file. Templates are React Email components rendered from a pure content model,
which keeps the HTML and plain-text alternatives in step and makes wording and
field selection testable without a provider key.

Delivery state lives in `EmailDelivery`, one row per inquiry and email type
under a unique constraint. Creating that row is how a request claims the send,
which is what makes replays and concurrent attempts safe without a queue. No
rendered body is stored, and provider acceptance is recorded as `ACCEPTED`
rather than `SENT`, because without webhooks inbox delivery is not known. See
[ADR 0007](DECISIONS/0007-transactional-email.md).

## SEO, analytics, and observability

SEO decisions live in pure builders under `src/lib/seo/` — canonical
normalization, crawl policy, sitemap contents, metadata assembly, and the JSON-LD
graph — with thin server wrappers supplying CMS content. That split is what makes
the whole SEO surface assertable offline, and it keeps the framework's metadata
contract in one place rather than spread across route files.

`NEXT_PUBLIC_SITE_URL` is the deployment origin, with `BETTER_AUTH_URL` as a
fallback. Without a usable origin nothing invents a hostname: the sitemap is
empty, `robots.txt` omits its sitemap reference, and canonicals stay relative.
Structured data is emitted as one `@graph` per page, built only from CMS content,
with every unsourced field omitted rather than guessed and every value escaped so
no content can close the script element. The admin area publishes no structured
data and is disallowed in `robots.txt`.

Analytics and error monitoring are optional and silently absent unless
configured. Umami is cookieless, mounted once in the public layout, and never
loaded in the admin area.

Error monitoring is the official `@sentry/nextjs` SDK in its current Next.js 15
App Router shape: `src/instrumentation.ts` initializes the Node and Edge
runtimes and exports `Sentry.captureRequestError` as `onRequestError`,
`src/instrumentation-client.ts` initializes the browser, and `next.config.ts` is
wrapped in `withSentryConfig`. All three `Sentry.init` calls spread one option
object, so a privacy decision cannot apply to some runtimes and not others.
Reporting is production-only and DSN-gated; with no DSN, `Sentry.init` is never
called. Tracing, session tracking, and Session Replay are off, every
`dataCollection` switch is at its narrowest value, and a `beforeSend` pass
strips user, cookie, header, body, and query data from any event regardless of
configuration. The Phase 8 Content-Security-Policy is widened by exactly two
directives, and only for origins actually configured. See
[ADR 0009](DECISIONS/0009-seo-production-deployment.md).

## External services

| Concern | Approved service | Introduction phase |
| --- | --- | --- |
| Relational data | Neon PostgreSQL | Phase 2 |
| Authentication | Better Auth | Phase 2 |
| Optimized website media | Cloudflare R2 | Phase 3 |
| Long-form portfolio video | YouTube | Phase 5 |
| Transactional email | Resend | Phase 7 |
| Bot protection | Cloudflare Turnstile | Phase 8 |
| Analytics | Umami | Phase 9 |
| Error monitoring | Sentry | Phase 9 |
| Uptime/log monitoring | Better Stack or free-compatible option | Phase 9/10 |
| Hosting | Netlify Free | Phase 9 (configuration) / Phase 10 (account) |

## Security and privacy controls

Phase 8 adds server-verified Turnstile, short-lived pseudonymous PostgreSQL rate
limits, application-specific security headers, and SUPER_ADMIN-only customer
export/anonymization. New inquiries pass abuse controls before persistence while
committed submission replays retain Phase 6 idempotency. See
[ADR 0008](DECISIONS/0008-security-privacy.md).

Accounts and credentials are requested only when their phase begins. The MVP
targets approximately EUR 0/month infrastructure cost, excluding domain
registration.

## Security philosophy

Security controls are designed into each boundary:

- authenticate and authorize on the server for every privileged operation;
- validate untrusted input and avoid leaking sensitive error details;
- use secure sessions/cookies and a CSRF-conscious mutation design;
- apply rate limiting and bot protection to abuse-prone public endpoints;
- validate upload size, MIME type, and actual file contents;
- strip EXIF/GPS metadata during image processing;
- use narrowly scoped presigned media operations and predictable object keys;
- add security headers and audit important administrative actions;
- keep credentials out of source control and client bundles.

Privacy is treated as a related requirement. The system minimizes personal data,
supports a documented inquiry-retention and deletion/anonymization process, and
loads third-party content only with appropriate user awareness or consent. Legal
pages and processor disclosures require review for the operating business; the
software is not legal advice or a guarantee of GDPR compliance.

## Media strategy

Cloudflare R2 stores optimized website assets, not RAW archives or complete photo
shoots. The planned image pipeline starts from an optimized master, strips
sensitive metadata, and produces responsive thumbnail, medium, large, and
optional modern-format variants. PostgreSQL stores dimensions, alt text, MIME
information, object keys, and relationships to portfolio content.

Critical images load eagerly only when justified; other images use responsive
sizing and lazy loading. Small optimized hero clips may use R2. Long-form
portfolio videos remain with a video provider.

The public site serves those R2 variants directly through `srcset` rather than
through the Next.js image optimizer, because the variants are already optimized
at the widths the layouts use. Layout stability and lazy loading are therefore
handled explicitly. Public delivery needs only the public read origin, so the
public site renders on a deployment holding no media write credentials. See
[ADR 0005](DECISIONS/0005-public-portfolio.md).

Video data uses a provider-neutral shape. Phase 5 implemented the minimum of it:
a `VideoProvider` enum plus provider, provider video ID, and title on `Project`
and on `SiteSetting` (the showreel). Embed URLs are built in code from those two
fields, never stored, so no iframe markup or embed script can come from content
and a later provider change touches one helper. YouTube embeds use
`youtube-nocookie.com` behind a click-to-load player that requests nothing from
the provider — not even a poster image — before the visitor activates it.

## Deployment direction

GitHub Actions will eventually run installation, linting, type checking, tests,
and a production build. Production deployment targets Netlify Free, backed by
Neon and the external services above. Production environment variables are
configured in the deployment platform, never committed. DNS, HTTPS, backups,
monitoring accounts, and final smoke tests belong to Phase 10.

`netlify.toml` publishes the Next.js build output through `@netlify/plugin-nextjs`
rather than a static export, so server rendering, ISR, on-demand revalidation by
tag, and the admin area all survive deployment. It deliberately declares no
security header — those stay owned by `securityHeaders()`, so one source of truth
applies identically to `next dev`, `next start`, and Netlify — and no cache rule
for a rendered route, because `Cache-Control` on rendered pages belongs to the
Next.js runtime and a blanket CDN rule would make on-demand revalidation
invisible. Only content-hashed output, image-handler output, fonts, generated
metadata files, and the private admin area carry cache rules.

## Internationalization readiness

English is the initial language. Full internationalization is out of scope for
Phase 1, but content structures and UI implementation should avoid assumptions
that make German support unnecessarily difficult.
