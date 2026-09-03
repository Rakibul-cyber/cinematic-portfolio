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

**Current phase: Phase 1 — Foundation & Design System.**

The Phase 1 frontend foundation is implemented with a responsive public shell,
centralized placeholder content, reusable UI primitives, local application-served
typography, reduced-motion-aware transitions, and a cinematic placeholder
homepage. The approved sequence and phase boundaries remain in the
[roadmap](docs/ROADMAP.md).

## Local development

Install the pinned dependencies and start the development server:

```powershell
npm install
npm run dev
```

Then open `http://localhost:3000`. Before proposing changes, run the available
quality checks:

```powershell
npm run lint
npm run typecheck
npm run build
```

Before contributing, read [Development](docs/DEVELOPMENT.md). Useful initial
checks are:

```powershell
git status
git branch --show-current
git remote -v
```

## Repository rules

- Work phase by phase and do not begin the next phase without approval.
- Keep secrets in local environment files; commit only `.env.example`.
- Do not commit dependencies, generated builds, logs, or credentials.
- Use conventional commits and review the full diff before committing.
- Do not rewrite Git history, force-push, or push without explicit approval.
- Record meaningful architectural decisions under `docs/DECISIONS/`.
