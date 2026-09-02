# Development Roadmap

Work proceeds in the approved order below. Every phase starts with repository
inspection, ends with validation and a written handoff, and requires explicit
approval before the next phase begins.

## Phase 0 — Project Setup & Architecture Freeze

- Establish the repository and Git foundation.
- Document architecture, development rules, and environment strategy.
- Record project-structure decisions and the approved stack.
- Gather a future content/assets checklist and prepare implementation.

No Next.js initialization or application dependencies belong in this phase.

## Phase 1 — Foundation & Design System

- Initialize Next.js 15, strict TypeScript, Tailwind CSS v4, and ESLint.
- Establish the application directory architecture.
- Configure local application-served fonts, global CSS, and design tokens.
- Build reusable primitives, a responsive site shell, header, and footer.
- Add foundational reduced-motion-aware motion utilities.
- Create a placeholder homepage shell.

## Phase 2 — Database & Authentication

- Configure Neon PostgreSQL and Prisma.
- Design the deliberate initial schema and migrations.
- Integrate Better Auth, admin login, and secure sessions.
- Establish roles, server-side authorization, and the audit foundation.

Neon is opened/configured during this phase.

## Phase 3 — Media System

- Configure Cloudflare R2.
- Implement the image-processing and optimized-variant strategy.
- Add secure presigned uploads and media metadata.
- Build the admin media library, deletion, and replacement workflows.

Cloudflare/R2 is opened/configured during this phase.

## Phase 4 — Admin CMS

- Build the admin dashboard.
- Add project CRUD and portfolio categories.
- Manage services, testimonials, settings, and publishing controls.
- Integrate media selection into content workflows.

## Phase 5 — Public Portfolio

- Complete the final homepage and Work listing.
- Build project detail pages and galleries.
- Add Services, About, and Contact pages.
- Add a privacy-enhanced, click-to-load YouTube player.
- Complete responsive cinematic presentation and selective interaction.

A YouTube account/channel is configured during this phase if needed.

## Phase 6 — Inquiry & CRM

- Build and validate the public inquiry form.
- Persist inquiries and deduplicate customer records.
- Add the CRM pipeline, statuses, internal notes, search, and filters.
- Add customer/inquiry history and CSV export.

## Phase 7 — Email & Notifications

- Configure Resend.
- Send admin inquiry notifications and customer confirmations.
- Build React Email templates and handle delivery outcomes.

Resend is opened/configured during this phase.

## Phase 8 — Security & GDPR

- Add Cloudflare Turnstile, database-backed rate limiting, and a honeypot.
- Apply security headers and review application security.
- Finalize consent-aware embeds and privacy controls.
- Implement the retention, deletion, and anonymization strategy.

## Phase 9 — SEO, Analytics & Testing

- Implement Metadata API usage, canonical URLs, Open Graph, and Twitter metadata.
- Add JSON-LD, sitemap, robots controls, and project metadata.
- Configure Umami and Sentry.
- Add valuable unit, integration, critical E2E, accessibility, and performance
  checks.

Umami, Sentry, and potentially Better Stack are configured during this phase.

## Phase 10 — Production Launch

- Configure Netlify and production environment variables.
- Connect the production database, DNS/domain, media domain, and HTTPS.
- Configure Search Console, monitoring, and backups.
- Run final security and production smoke tests.

Netlify and production DNS are configured during this phase.

## Phase 11 — Post-launch Performance & Polish

Only after real-world measurements:

- improve Core Web Vitals;
- tune image variants and caching;
- refine UX based on observed behavior;
- make analytics-informed improvements.

## Explicitly out of scope for the MVP

Customer accounts, client portals, private galleries, proofing/favorite
selection, payments, invoices, booking/calendar systems, automated quotations,
complex marketing automation, and mobile applications require separate approval
for a later release.
