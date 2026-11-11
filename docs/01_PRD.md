# 01 — Product Requirements Document

| Field | Value |
| --- | --- |
| Document | `docs/01_PRD.md` |
| Version | 1.4.0 (MH-15: categories and testimonials removed from the application, a project is public exactly when `PUBLISHED`; LOCAL ONLY, not deployed. MH-13: projects need no category) |
| Last reviewed | 2026-11-11 |
| Reviewed against | commit `b517fce` (branch `fix/sentry-production-initialization`) |
| Document status | Locally maintained draft. This status does not imply owner approval, push, or deployment. |
| Product owner | Studio owner, Munir Visuals |

## Purpose

This document states what Munir Visuals is for, who it serves, and which
requirements are implemented, gated, blocked, or still planned. It describes an
existing application. It does not restart the product as a new MVP.

## Related documents

| Document | Use it for |
| --- | --- |
| [02_AppFlow.md](02_AppFlow.md) | Routes, screens, and state machines behind each requirement |
| [03_UI_Spec.md](03_UI_Spec.md) | The visual system the requirements are presented in |
| [04_TRD.md](04_TRD.md) | Technology, endpoints, security controls, and deployment |
| [05_Schema.md](05_Schema.md) | Data model and authorization model |
| [06_Plan.md](06_Plan.md) | Task tracker, history, and release gates |
| [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), [DECISIONS/](DECISIONS/) | Earlier approved architecture, phase roadmap, and ADRs 0001–0011 |

## Status and release-state vocabulary

Every requirement carries two labels.

**Status** says what exists in code.

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Code exists in the repository and has passing automated tests at `4f7f564`. |
| PLANNED | Approved direction, no implementation yet. |
| BLOCKED | Cannot proceed until a named gate clears (legal, owner, infrastructure). |
| UNVERIFIED | Claimed or likely, but not demonstrated by repository evidence. |

**Release state** says where the code is. The repository cannot see Netlify, so
the published commit is owner-reported.

| Release state | Meaning | Commits |
| --- | --- | --- |
| PUBLISHED | In the build Netlify serves in production (owner-reported: `main@288fde6`). | up to `288fde6` |
| MAIN, UNPUBLISHED | On `main` locally and on GitHub (`1797766`), not published. Netlify Auto Publishing is locked. | `f37ff87`…`1797766` |
| LOCAL ONLY | Committed locally after `main`, never pushed. | `10f09b4`, `ce81964`, `be10fb4`, `4f7f564` |

Local fixes are never described as deployed.

## Source references

- Code: `src/app/`, `src/components/`, `src/server/`, `src/lib/`, `src/content/`
- Data: `prisma/schema.prisma`, `prisma/migrations/`
- Earlier documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/CONTENT_CHECKLIST.md`, `docs/DECISIONS/0001`–`0011`
- History: `git log` from `559382e` (2026-09-02) to `4f7f564` (2026-11-03)

---

## 1. Product overview

### 1.1 Core problem

A photography and videography studio needs to present cinematic work at the
quality it is sold on, keep that work current without a developer, and receive
client inquiries safely. Generic portfolio hosts and page builders give the
studio neither control over presentation nor a private place to manage content,
media, and client contacts.

### 1.2 Value proposition

One application that combines:

- a dark, editorial, media-first public portfolio;
- a private CMS that the studio uses to publish projects, services, and pages;
- a media pipeline that turns uploads into optimized, metadata-free web images;
- a controlled inquiry workflow with a small CRM and transactional email,
  which stays closed until legal approval.

Source: `docs/ARCHITECTURE.md` (Purpose), ADR 0001.

### 1.3 Product objectives

| ID | Objective | Evidence |
| --- | --- | --- |
| OBJ-01 | Present published photography and video at high visual quality on any device. | ADR 0005, `src/app/(public)/` |
| OBJ-02 | Let the studio manage all public content without code changes. | ADR 0004, `src/app/(admin)/admin/` |
| OBJ-03 | Turn qualified visitors into inquiries once legally permitted. | ADR 0006, `src/server/inquiry/submit-inquiry.ts` |
| OBJ-04 | Protect administrative access and client data by default. | ADR 0002, ADR 0008, ADR 0011 |
| OBJ-05 | Operate at approximately EUR 0/month infrastructure cost, excluding the domain. | ADR 0001, `docs/ARCHITECTURE.md` |

### 1.4 Target audience

Visitors who are evaluating the studio for photography or film work, and the
studio staff who maintain the site. The public site is English (`<html lang="en">`
in `src/app/layout.tsx`). Legal pages are drafted in German and English
(`src/content/legal.tsx`), which suggests an audience in a German-speaking
jurisdiction. **Assumption:** the operating business is subject to German
Impressum and GDPR requirements. The legal drafts imply this; it has not been
confirmed by legal review.

### 1.5 Business boundaries

- One studio, one brand (Munir Visuals), one website (owner-provided production
  domain `https://munirvisuals.com`; the repository configures the origin only
  through `NEXT_PUBLIC_SITE_URL`).
- Content is plain text. No arbitrary HTML or rich text (ADR 0004).
- The studio provisions administrators. There is no public registration.
- Inquiries are a contact channel, not a booking, quoting, or payment system.

## 2. Personas

Personas are grounded in the implemented routes and roles. Behavioural details
marked **Assumption** are not evidenced in the repository.

| ID | Persona | Grounding | Goals | Assumptions |
| --- | --- | --- | --- | --- |
| PER-01 | Portfolio visitor | Public routes `/`, `/work`, `/work/[slug]`, `/about` | Judge the studio's style and quality quickly. | Arrives from social media or search; often on a phone. |
| PER-02 | Potential photography client | Project gallery, services, inquiry form fields `projectType`, `budgetLabel` | Find relevant work, understand services, send an inquiry. | Compares several studios. |
| PER-03 | Potential videography client | Showreel and project video fields (`VideoProvider`, click-to-load player) | Watch film work without being tracked before choosing to. | Values privacy-respecting embeds. |
| PER-04 | Studio owner (`SUPER_ADMIN`) | `AdminRole.SUPER_ADMIN`; customer export and anonymization | Run the site and the client pipeline; handle privacy requests. | One person, sometimes on mobile (admin mobile work in `16f648e`). |
| PER-05 | Authorized CMS editor (`EDITOR`, also `ADMIN`) | `AdminRole.EDITOR`/`ADMIN`; ADR 0004 | Keep projects, services, and media current. | May be a freelancer with limited trust. |

## 3. Functional requirements (MVP user stories)

Each requirement lists ID, user story, acceptance criteria, status, release
state, dependencies, routes, and source evidence. Acceptance criteria describe
the behaviour the code already implements unless the status says otherwise.

### 3.1 Public site

#### FR-PUB-01 — Homepage

- **Story:** As a visitor, I want a cinematic homepage that shows the studio's
  best work and points me to more, so I can judge quality at a glance.
- **Acceptance criteria:**
  1. Renders hero, showreel, featured work, studio statement, services preview,
     and a contact call to action. The testimonials section and the category
     label in the hero were removed in MH-15 (LOCAL ONLY, not deployed; the
     published build still has them).
  2. All copy and media come from the CMS (`getHomepageContent`). Sections with
     no content are omitted rather than filled: no services means no services
     section, no showreel video means no showreel. Neutral visual placeholders
     stand in only where a frame has no image.
  3. Revalidates at most hourly (`revalidate = 3600`) and immediately on admin
     mutations through cache tags.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-01, FR-CMS-05, FR-CMS-06, FR-MED-01.
- **Routes:** `/`.
- **Evidence:** `src/app/(public)/page.tsx`, `src/components/sections/*`,
  `src/server/public/homepage.ts`, `src/server/public/homepage.test.ts`.

#### FR-PUB-02 — Portfolio browsing

- **Story:** As a visitor, I want to browse all published projects.
- **Acceptance criteria:**
  1. Lists exactly the projects whose status is `PUBLISHED`, in `sortOrder`
     (MH-15: `PUBLISHED_PROJECT_WHERE` is `{ status: "PUBLISHED" }`; the
     earlier MH-13 condition "no category, or an active category" is gone).
  2. There is no category filter (removed in MH-15). The page takes no
     `searchParams`; an old `/work?category=...` link shows the whole
     portfolio. The page revalidates at most hourly (`revalidate = 3600`) and
     on admin mutations through cache tags, like the other public pages.
  3. Publication is enforced in the query (`src/server/public/`), not hidden in
     the UI.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. The MH-15 changes (no
  filter, status-only visibility, static rendering) are LOCAL ONLY (working
  tree, uncommitted), not deployed; the published build still filters by
  category.
- **Dependencies:** FR-CMS-01.
- **Routes:** `/work`.
- **Evidence:** `src/app/(public)/work/page.tsx`,
  `src/server/public/publication.ts`, `src/server/public/queries.ts`,
  `src/server/public/public-content.test.ts`,
  `src/app/(admin)/admin/simplified-admin.test.ts`.

#### FR-PUB-03 — Project detail pages

- **Story:** As a prospective client, I want a full page per project with its
  gallery, description, and film.
- **Acceptance criteria:**
  1. `/work/[slug]` renders exactly the projects whose status is `PUBLISHED`
     (MH-15, LOCAL ONLY, not deployed; the page no longer shows a category
     label or a "Category" fact). A
     draft and a slug that never existed both return the same normal 404.
  2. Gallery follows `ProjectMedia.sortOrder` and roles `COVER`, `HERO`, `GALLERY`.
  3. Per-project SEO title and description override defaults when set.
  4. Published slugs are pre-rendered (`generateStaticParams`).
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-01, FR-MED-01.
- **Routes:** `/work/[slug]`.
- **Evidence:** `src/app/(public)/work/[slug]/page.tsx`,
  `src/components/public/project-gallery.tsx`, ADR 0005.

#### FR-PUB-04 — Photography presentation

- **Story:** As a visitor, I want images that are sharp, load fast, and do not
  shift the layout.
- **Acceptance criteria:**
  1. Images are served from R2 variants through `srcset` (320, 640, 1280, 1920
     widths and a master capped at 2560 px), not through the Next.js optimizer.
  2. A tiny blurred placeholder shows until the image loads.
  3. Non-critical images load lazily; priority images load eagerly.
  4. Alt text comes from the media library.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-MED-01.
- **Routes:** `/`, `/work`, `/work/[slug]`.
- **Evidence:** `src/components/public/media-image.tsx`,
  `src/lib/public/image-source.ts`, ADR 0003, ADR 0005.

#### FR-PUB-05 — Video presentation

- **Story:** As a videography client, I want to watch the studio's films without
  third-party tracking until I choose to play them.
- **Acceptance criteria:**
  1. Project video and the homepage showreel use a click-to-load player. Nothing
     is requested from the provider before activation, not even a poster.
  2. YouTube uses `youtube-nocookie.com`; Vimeo uses `dnt=1`; `EXTERNAL` has no
     embed URL and is never rendered as an iframe.
  3. Embed URLs are built in code from provider and video ID, never stored.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-01, FR-CMS-06.
- **Routes:** `/`, `/work/[slug]`.
- **Evidence:** `src/components/public/video-player.tsx`, `src/lib/video.ts`,
  `src/components/public/video-player.render-test.ts`.

#### FR-PUB-06 — Services

- **Story:** As a prospective client, I want to see the services offered and,
  where the studio chooses, a price label.
- **Acceptance criteria:** lists active services in `sortOrder` with name, short
  description, description, and optional `priceLabel`. The testimonials block
  that followed was removed in MH-15 (LOCAL ONLY, not deployed).
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-03, FR-CMS-05.
- **Routes:** `/services`.
- **Evidence:** `src/app/(public)/services/page.tsx`.

#### FR-PUB-07 — About

- **Story:** As a visitor, I want to learn who is behind the studio.
- **Acceptance criteria:** renders the `about` page content from the CMS. The
  testimonials block was removed in MH-15 (LOCAL ONLY, not deployed).
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-05.
- **Routes:** `/about`.
- **Evidence:** `src/app/(public)/about/page.tsx`.

#### FR-PUB-08 — Contact information

- **Story:** As a prospective client, I want direct contact details even while
  online inquiries are closed.
- **Acceptance criteria:**
  1. `/contact` shows studio contact details and active social links.
  2. While intake is closed, the page states "Online inquiries will open soon."
     and renders no inquiry form.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED (premium contact page `6113ec9`, `288fde6`).
- **Dependencies:** FR-CMS-06, FR-INQ-05.
- **Routes:** `/contact`.
- **Evidence:** `src/app/(public)/contact/page.tsx`,
  `src/components/contact/contact-sections.tsx`, `src/content/site.ts`.

#### FR-PUB-09 — Legal pages

- **Story:** As a visitor, I want the legally required Impressum and privacy
  notices in German and English.
- **Acceptance criteria:**
  1. `/impressum`, `/legal-notice`, `/datenschutz`, `/privacy` return 404 while a
     document is a draft (has a TODO or no valid approval record).
  2. Draft pages are hidden from the footer and the sitemap, and
     `npm run deploy:verify` fails while any draft remains.
  3. A page is released only by completing its facts and recording
     `{ approvedOn, approvedBy }` in `src/content/legal.tsx`.
- **Status:** Gating IMPLEMENTED. Publication **BLOCKED**: all four approvals are
  `null`.
- **Release:** gating PUBLISHED (`830f10e`, `f5e3b3c`).
- **Dependencies:** owner and qualified legal review (REL-03).
- **Routes:** `/impressum`, `/legal-notice`, `/datenschutz`, `/privacy`.
- **Evidence:** `src/content/legal.tsx:240-243`, `src/lib/legal/draft-status.ts`,
  `src/lib/legal/draft-status.render-test.ts`.

#### FR-PUB-10 — Search and sharing surfaces

- **Story:** As the studio owner, I want search engines and social previews to
  represent published work correctly.
- **Acceptance criteria:** metadata with canonical URLs, `sitemap.xml` of
  published content, `robots.txt` disallowing `/admin`, a generated Open Graph
  image, and JSON-LD built only from CMS content. Without a site origin, nothing
  invents a hostname.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Dependencies:** FR-CMS-01, FR-CMS-06.
- **Routes:** `/sitemap.xml`, `/robots.txt`, `/opengraph-image`, all public pages.
- **Evidence:** `src/lib/seo/*`, `src/app/sitemap.ts`, `src/app/robots.ts`,
  `src/app/opengraph-image.tsx`, ADR 0009, `npm run seo:verify`.

#### FR-PUB-11 — Not-found and error pages

- **Acceptance criteria:** public and admin route groups each have `not-found`
  and `error` boundaries; a root `global-error` exists.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Evidence:** `src/app/(public)/not-found.tsx`, `src/app/(public)/error.tsx`,
  `src/app/global-error.tsx`, `src/app/not-found.tsx`.

### 3.2 Client inquiry workflow

#### FR-INQ-01 — Inquiry submission

- **Story:** As a prospective client, I want to send a structured inquiry about
  my project.
- **Acceptance criteria:**
  1. Fields: name, email, optional phone, WhatsApp, and company, project type,
     optional date, location, budget, service, and referral source, and a
     message, validated by `inquirySchema`.
  2. Each submission carries a client-generated `submissionToken`. A replay of
     a committed token returns the same success answer and never creates a
     second inquiry.
  3. One success message is used for first submissions and replays alike.
- **Status:** IMPLEMENTED but **closed by the gate** (FR-INQ-05). Activation is
  **BLOCKED** (REL-03).
- **Release:** PUBLISHED (gated closed). Readiness hardening (`f37ff87`,
  `74bc665`) is MAIN, UNPUBLISHED.
- **Dependencies:** FR-INQ-02, FR-INQ-03, FR-INQ-04, FR-INQ-05.
- **Routes:** `/contact` (Server Action `submitInquiry`).
- **Evidence:** `src/server/inquiry/submit-inquiry.ts`,
  `src/server/inquiry/submit-inquiry.test.ts`, ADR 0006.

#### FR-INQ-02 — Abuse controls

- **Acceptance criteria:**
  1. A hidden `website` honeypot field rejects bots.
  2. Durable PostgreSQL rate limits: 5 per 10 minutes and 20 per 24 hours per
     pseudonymous identity (trusted client IP plus email, or email plus
     submission token). Raw identifiers are stored only as HMAC hashes.
  3. Cloudflare Turnstile is verified on the server. Missing configuration fails
     closed in production.
  4. Order: gate, validation, replay lookup, rate limit, Turnstile, persistence.
- **Status:** IMPLEMENTED.
- **Release:** PUBLISHED with a known defect, fixed LOCAL ONLY. In the published
  and `main` builds, the limiter's predictable fallback key and the Turnstile
  development bypass are decided by the runtime `NODE_ENV`. The local commits
  `ce81964` and `be10fb4` make both build-time decisions. The closed gate keeps
  the published defect unreachable (see 04_TRD, DEF-03).
- **Dependencies:** `RATE_LIMIT_HMAC_SECRET`, Turnstile keys (REL-05).
- **Evidence:** `src/server/security/rate-limit.ts`,
  `src/server/security/rate-limit-buckets.ts`, `src/server/security/turnstile.ts`,
  `src/server/security/*production-build.test.ts`, ADR 0008.

#### FR-INQ-03 — Customer deduplication and snapshots

- **Acceptance criteria:** customers are matched by trimmed, lower-cased email
  only. Each inquiry stores an immutable snapshot of the submitted fields.
  Matching is safe under concurrency (serializable transaction, upsert, bounded
  retry).
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Evidence:** `src/server/crm/service.ts`, ADR 0006, `npm run crm:verify`.

#### FR-INQ-04 — Transactional email

- **Story:** As the studio, I want an inquiry notification, and the client an
  acknowledgment, without email failures ever losing an inquiry.
- **Acceptance criteria:**
  1. Exactly two email types: `INQUIRY_ADMIN_NOTIFICATION` and
     `INQUIRY_CUSTOMER_ACKNOWLEDGMENT`, rendered with React Email.
  2. Delivery runs after the inquiry commits, outside any transaction.
  3. One `EmailDelivery` row per inquiry and type claims the send; provider
     acceptance is recorded as `ACCEPTED`, not "sent".
  4. Without Resend configuration, deliveries are recorded as `SKIPPED` and the
     inquiry is still stored.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. The claim-race fixes
  (`541a363`) are MAIN, UNPUBLISHED.
- **Evidence:** `src/server/email/service.ts`, `src/server/email/email.test.ts`,
  ADR 0007, `npm run email:verify`.

#### FR-INQ-05 — Inquiry activation gate

- **Story:** As the studio owner, I must not receive personal data before the
  privacy notice is approved.
- **Acceptance criteria:**
  1. `isInquiryIntakeOpen()` is true only when every legal document is complete
     and has a valid approval. There is no separate switch.
  2. The page hides the form, and the Server Action itself refuses before any
     other work while closed.
- **Status:** IMPLEMENTED. Intake state: **CLOSED**.
- **Release:** PUBLISHED (`f5e3b3c`).
- **Evidence:** `src/content/legal.tsx:265`, `src/app/(public)/contact/actions.ts`,
  `src/server/inquiry/submit-inquiry.ts:55`.

### 3.3 Administration

#### FR-ADM-01 — Admin authentication

- **Story:** As an administrator, I want to sign in with email and password, and
  nobody else should be able to register.
- **Acceptance criteria:**
  1. Email and password only, password length 12–128, sign-up disabled.
  2. One generic message for unknown email and wrong password
     ("Unable to sign in with those credentials.").
  3. Sign-out revokes the session in the database.
  4. `next` return paths accept only safe internal `/admin` paths.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Routes:** `/admin/login`, `/api/auth/[...all]`.
- **Evidence:** `src/server/auth/config.ts`, `src/lib/validation/auth.ts`,
  `src/server/auth/authorization.test.ts`, `scripts/verify-auth-flow.mjs`, ADR 0002.

#### FR-ADM-02 — Durable sign-in rate limiting

- **Acceptance criteria:**
  1. Per account: 6 attempts per 15-minute fixed window. Per client address: 20
     per 15 minutes. Every attempt counts, successful or not.
  2. Applies to both the HTTP route and the Server Action through a Better Auth
     `hooks.before` guard.
  3. While limited, the answer is 429 with `Retry-After`, worded the same for
     every account. Without a usable `RATE_LIMIT_HMAC_SECRET` or with storage
     failing, sign-in refuses with 503.
  4. Each newly limited window writes one `admin.sign_in_throttled` audit row.
- **Status:** IMPLEMENTED. **Release:** LOCAL ONLY (`10f09b4`, `ce81964`).
- **Dependencies:** `RATE_LIMIT_HMAC_SECRET` of at least 32 characters in every
  environment that allows sign-in (REL-05).
- **Evidence:** `src/server/auth/login-rate-limit.ts`,
  `src/server/auth/login-rate-limit.test.ts`, ADR 0011.

#### FR-ADM-03 — Sessions

- **Acceptance criteria:** sessions last 8 hours, slide at most hourly, and are
  read from PostgreSQL on every request (cookie cache disabled), so revocation is
  immediate. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Evidence:** `src/server/auth/config.ts` (`session`, `advanced`).

#### FR-ADM-04 — Roles and server-side authorization

- **Acceptance criteria:** roles `SUPER_ADMIN` > `ADMIN` > `EDITOR`. Every
  protected page and mutation checks on the server (`requireUser`,
  `requireAdmin`, `requireSuperAdmin`). Middleware only checks that a cookie is
  present and is never relied on for authorization.
- **Status:** IMPLEMENTED. Defect DEF-01 (EDITORs could delete media) is
  **fixed locally, not deployed** (04_TRD, DEF-01).
- **Release:** PUBLISHED. The DEF-01 fix is LOCAL ONLY (branch
  `fix/media-delete-admin-only`, commit `379e53b`, not pushed, merged, or
  deployed); the published and `main` builds
  still let an EDITOR delete media.
- **Evidence:** `src/server/auth/session.ts`, `src/server/auth/roles.ts`,
  `src/middleware.ts`, `src/server/auth/action-guards.test.ts`, ADR 0004.

#### FR-ADM-05 — Administrative dashboard

- **Acceptance criteria:** shows six counters, in this order: Projects,
  Published, Drafts, Media, New inquiries, Open inquiries; and three quick
  actions: "New project" (`/admin/projects/new`), "Upload media"
  (`/admin/media`), "View inquiries" (`/admin/inquiries`). The Services and
  Testimonials counters were removed in MH-15.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. The MH-15 dashboard is
  LOCAL ONLY (working tree, uncommitted), not deployed.
- **Routes:** `/admin`. **Evidence:** `src/app/(admin)/admin/page.tsx`,
  `src/app/(admin)/admin/simplified-admin.test.ts`.

#### FR-CMS-01 — Projects

- **Acceptance criteria:** create and edit projects with summary,
  description, client, location, date, featured flag, order, SEO fields, and
  video. A project has no category in the application (MH-13, MH-15): a save
  never writes `categoryId`, and the admin project list shows no category.
  The optional fields sit in a collapsed section titled "More options
  (optional)" (MH-15; formerly "Advanced details"; no field added or removed).
  `DRAFT`/`PUBLISHED` with a maintained `publishedAt`. Media assignment
  with ordered roles. Stale saves are refused (`project-version`). Deletion
  requires ADMIN and removes only join rows, never media.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. The MH-15 changes are LOCAL
  ONLY (working tree, uncommitted), not deployed.
- **Routes:** `/admin/projects`, `/admin/projects/new`, `/admin/projects/[id]`.
- **Evidence:** `src/server/cms/service.ts`, `src/lib/cms/project-version.ts`,
  `src/components/admin/project-form.tsx`, ADR 0004, `npm run cms:verify`.

#### FR-CMS-02 — Portfolio categories

- **REMOVED in MH-15** (ADR 0013). The application no longer has categories:
  the admin page `/admin/categories` (now the admin "Page not found" 404), its
  save and delete actions, the public category filter on `/work`, and the
  category label on project cards, the project page, and the home hero are
  deleted. The `portfolio_category` table and the nullable column
  `project.categoryId` remain in the database, unused: no migration was added
  and no table, column, or row was dropped or modified (05_Schema).
- **Status:** REMOVED from the code (not a status of the vocabulary above; the
  earlier implementation was IMPLEMENTED). **Release:** the removal is LOCAL
  ONLY (working tree, uncommitted), not deployed; the PUBLISHED build still
  contains the feature. **Routes:** none (formerly `/admin/categories`).

#### FR-CMS-03 — Services

- **Acceptance criteria:** name, slug, short and full descriptions, optional
  price label, order, and active flag. Deleting a service keeps past inquiries,
  whose `serviceId` is set to null and whose service name survives as a snapshot.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. **Routes:** `/admin/services`.

#### FR-CMS-04 — Testimonials

- **REMOVED in MH-15** (ADR 0013). The application no longer has
  testimonials: the admin page `/admin/testimonials` (now the admin "Page not
  found" 404), its save and delete actions, and the testimonial sections on
  `/`, `/about`, and `/services` are deleted. The `testimonial` table remains
  in the database, unused: no migration was added and no table or row was
  dropped or modified (05_Schema).
- **Status:** REMOVED from the code (not a status of the vocabulary above; the
  earlier implementation was IMPLEMENTED). **Release:** the removal is LOCAL
  ONLY (working tree, uncommitted), not deployed; the PUBLISHED build still
  contains the feature. **Routes:** none (formerly `/admin/testimonials`).

#### FR-CMS-05 — Pages

- **Acceptance criteria:** keyed page content (title, eyebrow, body, SEO
  fields) used by public pages such as About, Services, and Contact.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED. **Routes:** `/admin/pages`.

#### FR-CMS-06 — Site settings and social links

- **Acceptance criteria:** studio name, tagline, contact details, footer text,
  default SEO, showreel video, and social links. ADMIN or above only. An EDITOR
  receives 403.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED (403 behaviour `5487fc2`).
- **Routes:** `/admin/settings`.

#### FR-MED-01 — Media upload and processing

- **Acceptance criteria:**
  1. JPEG, PNG, or WebP up to 15 MB and 12,000 px; contents validated, not just
     the extension.
  2. Sharp produces a metadata-free WebP master (max 2560 px) and 320, 640,
     1280, and 1920 px variants that never upscale, plus a blur placeholder.
  3. Objects are stored at `media/YYYY/MM/<uuid>/<variant>.webp`. A failure
     cleans up the objects already uploaded.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Routes:** `/admin/media`, `POST /api/media`.
- **Evidence:** `src/server/media/*`, `src/server/media/media.test.ts`, ADR 0003,
  `npm run media:verify`.

#### FR-MED-02 — Media metadata and deletion

- **Acceptance criteria:**
  1. Alt text (≤500) and caption (≤2000) are editable by every role.
  2. Only ADMIN and SUPER_ADMIN may permanently delete media, including
     unassigned images (OD-01, resolved 2026-11-03). The Delete control is
     shown only to them, and the Server Action refuses an EDITOR who calls it
     directly.
  3. Deletion refuses while a project uses the image, removes every R2 object,
     and only then deletes the row. A concurrent assignment can break this
     ordering (DEF-04, open).
- **Status:** IMPLEMENTED. DEF-01 fixed locally, not deployed; DEF-04 open.
- **Release:** PUBLISHED (EDITOR deletion still allowed there). The ADMIN-only
  rule is LOCAL ONLY (branch `fix/media-delete-admin-only`, commit `379e53b`,
  not pushed, merged, or deployed).
  **Routes:** `/admin/media`.

#### FR-CRM-01 — Inquiry management

- **Acceptance criteria:** paginated list (25 per page) with search across name,
  email, company, and project type, and a status filter. Detail view shows the
  snapshot, current customer, status history, and email deliveries. Status
  changes append history.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Routes:** `/admin/inquiries`, `/admin/inquiries/[id]`.

#### FR-CRM-02 — Customers and notes

- **Acceptance criteria:** paginated, searchable customer list. Detail view with
  editable contact fields, internal notes, and inquiry history.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Routes:** `/admin/customers`, `/admin/customers/[id]`.

#### FR-CRM-03 — Exports

- **Acceptance criteria:** inquiry CSV export needs ADMIN or above; per-customer
  data export needs SUPER_ADMIN. Each export is audited.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Routes:** `/admin/inquiries/export`, `/admin/customers/[id]/export`.

#### FR-CRM-04 — Anonymization

- **Acceptance criteria:** SUPER_ADMIN only and idempotent. Replaces customer
  identity and inquiry personal fields with neutral values, keeps the operational
  relation, and is audited without PII.
- **Status:** IMPLEMENTED. **Release:** PUBLISHED.
- **Evidence:** `src/server/privacy/service.ts`, `src/server/privacy/service.test.ts`.

#### FR-EML-01 — Email delivery visibility and recovery

- **Acceptance criteria:**
  1. Inquiry detail lists each delivery's status and attempts.
  2. A `FAILED` delivery can be retried.
  3. A delivery stuck in `PROCESSING` for over 5 minutes can be confirmed and
     recovered.
  4. Missing delivery rows can be recovered.
  5. A possible-duplicate warning appears where a send may already have reached
     the provider.
  6. Erased (anonymized) inquiries never send.
- **Status:** IMPLEMENTED.
- **Release:** retry PUBLISHED. Recovery of missing emails, stale-claim handling,
  and the duplicate warning (`12b279a`, `541a363`, `1797766`) are MAIN,
  UNPUBLISHED.
- **Evidence:** `src/server/email/recovery-workflow.ts`,
  `src/lib/email/delivery-claims.ts`, `src/components/admin/email-delivery-rows.tsx`,
  `src/server/email/recovery.test.ts`.

## 4. Nonfunctional requirements

| ID | Area | Requirement | Status | Evidence |
| --- | --- | --- | --- | --- |
| NFR-PERF-01 | Performance | Public pages are statically rendered with hourly ISR plus tag revalidation; images use pre-sized R2 variants; fonts are self-hosted by `next/font`. | IMPLEMENTED | `src/server/public/cache-tags.ts`, ADR 0005 |
| NFR-PERF-02 | Performance | Core Web Vitals targets are set from real measurements after launch. | PLANNED (Roadmap Phase 11) | `docs/ROADMAP.md` |
| NFR-A11Y-01 | Accessibility | Design toward WCAG 2.2 AA: skip link, visible focus, labelled controls, live regions, keyboard-operable admin, reduced motion. | IMPLEMENTED, not externally audited | `src/app/globals.css`, `admin-a11y.render-test.ts`, `153cd19` |
| NFR-SEC-01 | Security | Server-side authorization on every privileged operation. | IMPLEMENTED (DEF-01 fixed locally, not deployed) | 04_TRD §7 |
| NFR-SEC-02 | Security | Security headers including CSP, `nosniff`, `no-referrer`, and Permissions-Policy, owned by `securityHeaders()`. | IMPLEMENTED | `src/lib/security-headers.ts` |
| NFR-SEC-03 | Security | Abuse-prone endpoints are rate limited and fail closed without configuration. | IMPLEMENTED; production-build fail-closed is LOCAL ONLY | ADR 0008, ADR 0011 |
| NFR-PRIV-01 | Privacy | Data minimization, pseudonymous rate-limit keys, no third-party requests before consent for video, cookieless analytics only. | IMPLEMENTED | ADR 0008, ADR 0009 |
| NFR-PRIV-02 | Privacy | Documented retention periods and an automated retention process. | PLANNED; only manual anonymization exists | `docs/CONTENT_CHECKLIST.md`, OD-07 |
| NFR-REL-01 | Reliability | No email failure can lose or hide a stored inquiry; idempotent replays. | IMPLEMENTED | ADR 0007 |
| NFR-REL-02 | Reliability | Database backups and restore procedure. | PLANNED (Roadmap Phase 10) | `docs/ROADMAP.md` |
| NFR-SEO-01 | SEO | Canonical URLs, sitemap, robots, Open Graph, JSON-LD from CMS only. | IMPLEMENTED | ADR 0009 |
| NFR-RESP-01 | Responsive | Layouts adapt at Tailwind `sm`/`md`/`lg`, with a mobile navigation and admin mobile layout. | IMPLEMENTED | 03_UI_Spec §6 |
| NFR-MAINT-01 | Maintainability | Strict TypeScript, ESLint, focused modules, ADRs for architectural change. | IMPLEMENTED | `tsconfig.json`, `docs/DEVELOPMENT.md` |
| NFR-MAINT-02 | Maintainability | CI that runs lint, type check, tests, and build. | PLANNED; no `.github/` directory exists | `docs/ARCHITECTURE.md` (Deployment direction) |
| NFR-OBS-01 | Observability | Optional Sentry (production and DSN-gated, PII scrubbed) and optional Umami. | IMPLEMENTED in code; accounts not configured (UNVERIFIED). Server initialization no longer depends on the runtime `NODE_ENV` (DEF-02, fixed locally, not deployed). | ADR 0009 |
| NFR-OBS-02 | Observability | Uptime and log monitoring. | PLANNED (Roadmap Phase 10) | `docs/ARCHITECTURE.md` |

## 5. Success metrics

No targets have been approved. Everything below is **PROPOSED** and needs owner
approval before it is used to judge the product.

| ID | Metric | Proposed target | Measurement source |
| --- | --- | --- | --- |
| MET-01 | Largest Contentful Paint (mobile, p75) | ≤ 2.5 s | Field data after launch (OD-09) |
| MET-02 | Cumulative Layout Shift (p75) | ≤ 0.1 | Field data after launch |
| MET-03 | Inquiry submissions that commit, out of valid attempts | ≥ 99% | Inquiry failure-log categories (`src/server/inquiry/failure-log.ts`) |
| MET-04 | Email deliveries `ACCEPTED` within 5 minutes of inquiry | ≥ 98% | `email_delivery` status and timestamps |
| MET-05 | Time for the owner to publish a new project | ≤ 15 minutes | Owner observation |
| MET-06 | Accessibility defects found by automated audit on public pages | 0 serious or critical | Audit tool to be chosen (OD-10) |
| MET-07 | Inquiries per month once intake opens | Baseline first, no target | `inquiry.createdAt` |

## 6. Strict out of scope (non-goals)

Not implemented and not approved. Each requires separate written approval.

- E-commerce, online payments, invoices, or quotations.
- Public customer accounts, client portals, private galleries, proofing.
- Booking or calendar systems.
- Social networking features, marketplaces.
- AI-generated media. `neon.ts` enables a Neon "AI gateway" preview in tooling
  configuration; the application does not use it (OD-11).
- Native mobile applications.
- Analytics other than the optional, cookieless Umami integration.
- New infrastructure providers beyond Neon, Cloudflare R2, Cloudflare Turnstile,
  Resend, Netlify, Sentry, Umami, and YouTube/Vimeo embeds.
- Marketing, status-change, reminder, or booking email.
- Full internationalization (English UI; German readiness only).

Source: `docs/ROADMAP.md` ("Explicitly out of scope"), ADR 0007.

## 7. Release requirements

The public site is published. These gates govern **any further release**,
including publishing `main` and opening inquiries. None may be bypassed.

| ID | Gate | State | Clears when |
| --- | --- | --- | --- |
| REL-01 | Security review of the local commits `10f09b4`, `ce81964`, `be10fb4`, `4f7f564` | IN REVIEW | Owner review accepts them for merge. |
| REL-02 | Database-backed integration verification (SD-13I) | **BLOCKED (postponed by owner)** | `npm run integration:run` passes on a disposable Neon branch after explicit authorization. |
| REL-03 | Legal approval of all four legal documents | **BLOCKED** | A qualified reviewer approves final texts and approvals are recorded. Intake opens only then, and only with a separate owner decision. |
| REL-04 | Production administrator | **NOT AUTHORIZED** | Owner authorizes `npm run admin:bootstrap` against production. Production currently has 0 administrator accounts (owner-reported). |
| REL-05 | Production environment prerequisites | UNVERIFIED | Netlify has `RATE_LIMIT_HMAC_SECRET` (≥32 chars), Better Auth, R2, and Neon variables. Turnstile and Resend are set before intake opens. Verified by the owner without exposing values. |
| REL-06 | Deployment verification | TODO | An unpublished Netlify deploy of the candidate commit passes smoke tests while Auto Publishing stays locked. |
| REL-07 | Rollback plan | TODO | A previous published deploy is identified as the restore point, and migration compatibility is checked (04_TRD §8.6). |
| REL-08 | Owner authorization to publish | **NOT AUTHORIZED** | Explicit owner instruction. |

Controlled release status: **NOT AUTHORIZED.**

## Open decisions

| ID | Decision | Owner |
| --- | --- | --- |
| OD-01 | **RESOLVED 2026-11-03:** only ADMIN and SUPER_ADMIN may permanently delete media; EDITORs may not, including unassigned images. Matches ADR 0004. Fix: DEF-01. | Owner |
| OD-02 | Should EDITORs be able to retry or recover email and edit customer contact data? Code allows both. | Owner |
| OD-03 | Password reset and MFA for administrators: neither exists. | Owner + security |
| OD-04 | Brand naming in technical identifiers: package `cinematic-portfolio`, Better Auth `appName` "Cinematic Portfolio Admin", fallback studio name "Portfolio". | Owner |
| OD-05 | Should inquiry status transitions be restricted? Any status can currently move to any status. | Owner |
| OD-07 | Inquiry retention period and whether to automate deletion or anonymization. | Owner + legal |
| OD-09 | Approve success-metric targets (§5). | Owner |
| OD-10 | Choose an accessibility audit method. | Owner |
| OD-11 | Purpose of `neon.ts` (Neon tooling config with an AI gateway preview) in an application that has no AI features. | Owner |

The full register, including technical decisions, is in
[06_Plan.md](06_Plan.md#decision-register).

## Known limitations

- Online inquiries are closed until legal approval. Visitors can only use the
  displayed contact details.
- No password reset, MFA, or self-service account management for administrators.
- No automated retention; personal data persists until manually anonymized.
- No CI pipeline; checks run locally.
- Media supports images only (`MediaKind` has only `IMAGE`). Video is
  embed-only.
- The UI is English only.
- The repository cannot prove what is published; release states for Netlify are
  owner-reported.
