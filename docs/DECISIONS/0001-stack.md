# ADR 0001: Application Stack and Free-First Infrastructure

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision owners:** Project owner and implementation team

## Context

The product requires a premium public portfolio, private CMS, optimized media
management, and a lightweight inquiry/customer CRM. It must be maintainable by a
small team, protect administrative and customer data, support EU privacy needs,
and launch with approximately EUR 0/month infrastructure cost apart from domain
registration.

Splitting the product into multiple applications or introducing paid services at
the outset would add operational cost and complexity without a demonstrated MVP
need.

## Decision

Build one full-stack Next.js 15 application using:

- App Router, React, strict TypeScript, and Tailwind CSS v4;
- custom public UI plus Radix/shadcn-style primitives where useful for admin;
- selective Motion animation and Lucide icons;
- Server Components by default, with Server Actions and Route Handlers for server
  behavior;
- Zod for boundary validation;
- PostgreSQL on Neon through Prisma;
- Better Auth for authentication and session foundations;
- Cloudflare R2 for optimized website media, not RAW archives;
- provider-neutral video records, initially rendered through privacy-enhanced,
  consent-aware YouTube embeds;
- Resend (and React Email where useful) for transactional email;
- Cloudflare Turnstile plus database-backed MVP rate limiting;
- Umami analytics, Sentry error monitoring, and free-compatible uptime/log
  monitoring;
- Netlify Free for hosting and GitHub Actions for continuous integration.

Fonts will be served by the application, including through `next/font` where
appropriate, so visitors do not make runtime Google Fonts requests.

The MVP follows a free-first policy. Do not add paid hosting, video, caching,
database, CMS, image CDN, or other infrastructure unless the approved free stack
cannot meet a genuine requirement, the tradeoffs and migration impact are
documented, and the project owner explicitly approves the change.

## Consequences

### Benefits

- One codebase and deployment keep operational boundaries understandable.
- Server-first rendering and colocated backend behavior suit the content-heavy
  public site and admin workflows.
- Managed free tiers reduce launch cost while retaining migration paths.
- Provider-neutral media/video domain concepts limit avoidable lock-in.
- Services are configured only when needed, reducing early credential and account
  sprawl.

### Tradeoffs

- Free tiers have quotas, cold-start/performance characteristics, and support
  limits that must be monitored.
- The single application requires disciplined module boundaries so public and
  privileged code do not become coupled.
- Database-backed rate limiting is adequate for MVP scale but may need replacement
  if measured traffic or abuse makes it inefficient.
- Netlify compatibility must be verified as framework features are introduced.

## Reconsideration triggers

Revisit this decision only with evidence such as sustained quota pressure,
measured reliability or latency problems, a security/compliance requirement, or
an unsupported production capability. Any proposal must state the current choice,
replacement, benefits, drawbacks, cost, and migration impact before approval.
