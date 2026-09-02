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
| Hosting | Netlify Free | Phase 10 |

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

Video data will use a provider-neutral shape such as provider, provider video ID,
embed URL, thumbnail URL, title, description, duration, and privacy mode. YouTube
embeds should use `youtube-nocookie.com` and a click-to-load/consent-aware
experience so a later provider change does not require redesigning the domain.

## Deployment direction

GitHub Actions will eventually run installation, linting, type checking, tests,
and a production build. Production deployment targets Netlify Free, backed by
Neon and the external services above. Production environment variables are
configured in the deployment platform, never committed. DNS, HTTPS, backups,
monitoring, and final smoke tests belong to Phase 10.

## Internationalization readiness

English is the initial language. Full internationalization is out of scope for
Phase 1, but content structures and UI implementation should avoid assumptions
that make German support unnecessarily difficult.
