# 06 — Dependency-Ordered Implementation Plan

| Field | Value |
| --- | --- |
| Document | `docs/06_Plan.md` |
| Version | 1.4.0 (MH-10: Mux removed; external video embeds with Google Drive; committed as `f10cb7d` on `feature/external-video`) |
| Last reviewed | 2026-11-07 |
| Reviewed against | commit `b1a579d` and the RR-03 bundle-test changes made on top of it (branch `fix/sentry-production-initialization`) |
| Document status | Locally maintained draft. This status does not imply owner approval, push, or deployment. |

## Purpose

This is the canonical task tracker for Munir Visuals. It records the work
already done, using repository evidence, and lists future work in dependency
order. It does not restart the project: Roadmap Phases 0–9 and Phase 10A are
history here, and the remaining work is release readiness and the open
decisions.

## Related documents

[01_PRD.md](01_PRD.md) (requirements `FR-*`, `NFR-*`, gates `REL-*`) ·
[02_AppFlow.md](02_AppFlow.md) · [03_UI_Spec.md](03_UI_Spec.md) ·
[04_TRD.md](04_TRD.md) (defects `DEF-*`, debt `TD-*`, conflicts `CONF-*`) ·
[05_Schema.md](05_Schema.md) · [ROADMAP.md](ROADMAP.md) (original phase plan)

## Source references

`git log` (`559382e` 2026-09-02 → `4f7f564` 2026-11-03), `git branch -a`, the
test suites (`npm test`), and the documents above.

## Status values

| Status | Use |
| --- | --- |
| DONE | Implemented and verified by named evidence (commit and passing tests). DONE says nothing about deployment; the release state is stated separately. |
| IN PROGRESS | Work started and not verified complete. |
| TODO | Approved or necessary, not started. |
| BLOCKED | Cannot start or finish until a named blocker clears. |
| UNVERIFIED | May be done, but the repository holds no sufficient evidence. |

Release states (PUBLISHED, MAIN UNPUBLISHED, LOCAL ONLY) are defined in
[01_PRD.md](01_PRD.md#status-and-release-state-vocabulary). **A local fix is
never marked deployed.**

## Current release position (2026-11-04)

| Item | State |
| --- | --- |
| Published production | `main@288fde6` (owner-reported) |
| `main` (local = GitHub) | `1797766`, not published |
| Local only, unpushed | `10f09b4` → `ce81964` → `be10fb4` → `4f7f564` |
| Netlify Auto Publishing | LOCKED |
| Inquiry intake | CLOSED |
| Legal approvals | Pending (all four `null`) |
| Production administrators | 0; creation not authorized |
| Database-backed integration testing | **POSTPONED by owner (BLOCKED)** |
| DEF-01 media-deletion fix | LOCAL ONLY: commit `379e53b` on `fix/media-delete-admin-only`; not pushed, merged, or deployed |
| DEF-02 server-Sentry fix | LOCAL ONLY: commit `b517fce` on `fix/sentry-production-initialization`; not pushed, merged, or deployed |
| Production-bundle verification | Compile-only bundle verified at `b1a579d` (RR-02); offline bundle tests added, uncommitted (RR-03, P4-14). Node.js 22 run PENDING. Full build UNVERIFIED (needs a database, P4-03). |
| Photo upload resize (P3-09) | LOCAL ONLY: `6b4f75d` on `feature/media-upload-resize`; not pushed, merged, or deployed. Real-browser checks PENDING. |
| Video foundation helpers (P3-10) | LOCAL ONLY: committed on `feature/video-mvp-foundation` (parent `6b4f75d`); not integrated, pushed, merged, or deployed. |
| Video provider boundary (P3-11A) | LOCAL ONLY: committed on `feature/video-upload-backend` (parent `e681ffa`) as `18a6f76`; not integrated, pushed, merged, or deployed. |
| Video services (P3-11B) | LOCAL ONLY: committed as `6868cbe` on `feature/video-upload-backend` (parent `18a6f76`); not integrated, pushed, merged, or deployed. |
| Video database adapter and routes (P3-11C) | LOCAL ONLY: committed as `b440dcf` on `feature/video-upload-backend` (parent `6868cbe`); migration `20261106120000_add_uploaded_video` NOT APPLIED to any database; not pushed, merged, or deployed. |
| Admin video library (P3-11D) | LOCAL ONLY: committed as `cd79df9` on `feature/video-upload-backend` (parent `b440dcf`); uploads disabled until the Mux upload host is confirmed; not pushed, merged, or deployed. |
| Project videos and public Films (P3-11E) | LOCAL ONLY: committed as `186d489` on `feature/video-upload-backend` (parent `cd79df9`); needs the unapplied P3-11C migration and a configured Mux account; not pushed, merged, or deployed. |
| Uploaded video via Mux (P3-11A–E) | **WITHDRAWN** by owner decision (MH-10, ADR 0012); code removed on `feature/external-video`; its migration was never applied. |
| External video embeds (MH-10) | LOCAL ONLY on `feature/external-video`; migration `20261107120000_add_google_drive_video_provider` NOT APPLIED; not pushed, merged, or deployed. |
| Controlled release | **NOT AUTHORIZED** |

## SD work-package history

SD identifiers are the owner's work-package labels. The repository mentions
only "SD-13F" (in the message of `ce81964`). Everything else in this table maps
the owner's descriptions to commits.

| Package | Description | Status | Release state | Evidence |
| --- | --- | --- | --- | --- |
| SD-12 | Not described in the repository or in the SD-13 task briefs | **UNVERIFIED** | — | No repository evidence; the owner must supply its scope. |
| SD-13E | Local login-hardening implementation | DONE | LOCAL ONLY | `10f09b4` (2026-11-01), ADR 0011, `login-rate-limit.test.ts` |
| SD-13F | Conditional release verification | DONE (outcome: conditional, release not authorized) | — | Findings F1 (HMAC fallback, runtime `NODE_ENV`) and F3 (stale dashboard-email assertion) are cited in `ce81964`. Other findings are not recorded in the repository (UNVERIFIED). |
| SD-13G | HMAC fail-closed correction (F1), F3 correction | DONE | LOCAL ONLY | `ce81964` (2026-11-03), `rate-limit-production-build.test.ts` |
| SD-13H | Turnstile production fail-closed correction | DONE | LOCAL ONLY | `be10fb4` (2026-11-03), `turnstile-production-build.test.ts` |
| SD-13I | Integration harness | Implementation DONE; database-backed verification **BLOCKED (postponed)** | LOCAL ONLY | `4f7f564` (2026-11-03); `scripts/integration/`; never run against a database |
| — | Controlled release | **NOT AUTHORIZED** | — | Owner instruction |

---

## Phase 0 — Architecture baseline

#### P0-01 — Repository inventory
- **Status:** DONE · **Completed:** 2026-11-03
- **Depends on:** none · **Requirements:** all
- **Files:** whole repository (read only)
- **Acceptance:** routes, modules, schema, versions, tests, configuration, and
  history are inventoried in 01–05.
- **Tests:** schema-versus-migration comparison (0 differences, 211 columns),
  lockfile version extraction, route-tree listing.
- **Evidence:** 05_Schema §"Verification of this document"; 04_TRD §1; 02_AppFlow §1.
- **Security impact:** none (read only; no private environment file read).
- **Production impact:** none.

#### P0-02 — Existing feature verification
- **Status:** IN PROGRESS
- **Depends on:** P0-01 · **Requirements:** FR-*
- **Acceptance:** every IMPLEMENTED requirement has passing automated evidence
  (DONE for unit and render tests), **and** each is checked against a running
  build (open: blocked on P4-03 and P4-10 for database-backed paths).
- **Tests:** `npm test` 472 passed / 2 skipped, render 264 passed (at `4f7f564`).
- **Evidence:** test runs recorded in the SD-13H and SD-13I reports.
- **Security impact:** none. **Production impact:** none.

#### P0-03 — Context Architecture (six documents, `CLAUDE.md`, `.cursorrules`)
- **Status:** DONE · **Completed:** 2026-11-03 · owner reviewed and authorized the commit; committed locally as `2e3419a`, not pushed, merged, or deployed. Later revisions are recorded in each document's version header.
- **Depends on:** P0-01
- **Files:** `docs/01_PRD.md` … `docs/06_Plan.md`, `CLAUDE.md`, `.cursorrules`
- **Acceptance:** all eight files exist, cross-links resolve, IDs are
  consistent, the facts match the repository, and the owner approves.
- **Tests:** cross-document consistency checks (link, ID, route, version,
  schema, and secret scans).
- **Evidence:** commit `2e3419ac93e9a0d6c7743b14ac88747a31791d56` (`docs(architecture): establish Munir Visuals context baseline`); cross-document consistency checks 27 passed, 0 failed before that commit.
- **Security impact:** none. **Production impact:** none.

#### P0-04 — Resolve open decisions
- **Status:** TODO
- **Depends on:** P0-03
- **Acceptance:** each item in the [decision register](#decision-register) is
  decided, recorded (an ADR where architectural), and linked to its tasks.
- **Security impact:** OD-03, OD-06, and OD-15 affect security (OD-01 resolved 2026-11-03).
- **Production impact:** none until implemented.

#### P0-05 — Release-state inventory confirmation
- **Status:** IN PROGRESS. The repository side is done; the Netlify side is owner-reported.
- **Acceptance:** the owner confirms the published commit (`288fde6`), whether
  any unpublished deploy of `1797766` exists, and the deploy-preview settings.
- **Evidence:** 04_TRD §8.3.
- **Production impact:** none (read only).

## Phase 1 — Database and authentication

#### P1-01 — Schema validation
- **Status:** DONE · **Completed:** 2026-11-03 (offline)
- **Requirements:** NFR-MAINT-01 · **Files:** `prisma/schema.prisma`, `prisma/migrations/`
- **Acceptance:** schema and migrations agree on tables, columns, nullability, and foreign keys.
- **Tests:** mechanical comparison: 21 tables, 211 columns, 15 foreign keys, 0 differences.
- **Evidence:** 05_Schema SCH-V-01…05.
- **Security impact:** none. **Production impact:** none.

#### P1-02 — Migration verification against deployed databases
- **Status:** BLOCKED (needs authorized database access; database work is postponed)
- **Depends on:** P1-01
- **Acceptance:** `npm run db:migrate:status` reports all 7 migrations applied
  on the production database and on any preview branch, with no drift.
- **Tests:** `db:migrate:status` (read only).
- **Security impact:** read-only access to production metadata; needs explicit authorization.
- **Production impact:** none (read only).

#### P1-03 — Administrator authentication
- **Status:** DONE · **Completed:** 2026-09-07 · **Release:** PUBLISHED
- **Requirements:** FR-ADM-01, FR-ADM-03
- **Files:** `src/server/auth/config.ts`, `session.ts`, `src/app/(admin)/admin/login/`
- **Tests:** `authorization.test.ts`, `action-guards.test.ts`; `auth:verify` (live, last run before SD-13; not re-run since).
- **Evidence:** `85ae255`, ADR 0002; return-path validation `e5a214a`.
- **Security impact:** core. **Production impact:** live.

#### P1-04 — Role authorization
- **Status:** DONE · **Completed:** 2026-09-08; fixes 2026-10-06, 2026-10-26, 2026-10-27. DEF-01 fixed locally under P1-07 (not deployed)
- **Requirements:** FR-ADM-04
- **Evidence:** `3092221`, `29c5b6c`, `5487fc2`; `action-guards.test.ts`; `expected-errors.test.ts`.
- **Security impact:** core. **Production impact:** live.

#### P1-05 — Durable sign-in rate limiting (SD-13E, SD-13G)
- **Status:** DONE · **Completed:** 2026-11-01 (`10f09b4`), 2026-11-03 (`ce81964`) · **Release:** LOCAL ONLY
- **Depends on:** P1-03, P2-05 · **Requirements:** FR-ADM-02, NFR-SEC-03
- **Files:** `src/server/auth/login-rate-limit.ts`, `src/server/security/rate-limit-buckets.ts`, `src/server/security/client-ip.ts`, `src/server/auth/config.ts`
- **Acceptance:** account 6/15 min and client 20/15 min; 429 with `Retry-After`;
  503 without a usable key; the fallback key is absent from production bundles.
- **Tests:** `login-rate-limit.test.ts` (real Better Auth, PGlite statements),
  `rate-limit-production-build.test.ts` (8 tests fail against the pre-fix code).
- **Evidence:** commits above; ADR 0011; compiled-bundle inspection in SD-13G.
- **Security impact:** high (closes unlimited Server Action sign-in attempts).
- **Production impact:** none until published. Publishing **requires
  `RATE_LIMIT_HMAC_SECRET`** in Netlify, or administrator sign-in answers 503 (P5-02).

#### P1-06 — Session management
- **Status:** DONE · **Completed:** 2026-09-07 · **Release:** PUBLISHED
- **Requirements:** FR-ADM-03
- **Acceptance:** 8 h sessions, database-checked, revoked on sign-out.
- **Tests:** unit coverage of guards; live expiry check is in the SD-13I harness (BLOCKED, P4-03).
- **Security impact:** core. **Production impact:** live.

#### P1-07 — Fix media deletion authorization (DEF-01)
- **Status:** DONE (offline verification) · **Completed:** 2026-11-03 · **Release:** LOCAL ONLY. Committed as `379e53b` on branch `fix/media-delete-admin-only` (parent `2e3419a`); not pushed, merged, or deployed.
- **Depends on:** OD-01 (resolved 2026-11-03: ADMIN and SUPER_ADMIN only) · **Requirements:** FR-MED-02, FR-ADM-04
- **Files:** `src/app/(admin)/admin/media/actions.ts` (guard `requireAdmin(ADMIN_MEDIA_PATH)`),
  `src/app/(admin)/admin/media/page.tsx` (`canDelete = isAdministrative(user.role)`),
  `src/server/auth/action-guards.test.ts` (expects `requireAdmin`),
  `src/app/(admin)/admin/expected-errors.test.ts` (role-gated control),
  `src/app/(admin)/admin/media/delete-authorization.test.ts` (new).
- **Acceptance:** `deleteMediaAction` requires ADMIN; the Delete control is
  hidden from EDITORs; an EDITOR calling the action directly is refused and
  nothing is deleted; `updateMediaMetadataAction` is unchanged.
- **Tests:** `delete-authorization.test.ts` bundles the real action with the
  real `requireAdmin` → `requireRole` → `requireUser` → `getCurrentUser` chain
  and stubs only Better Auth, Prisma's user read, Next.js request and cache
  APIs, and the media service. 8 tests: EDITOR refused, refusal before input
  validation, role taken from the user row rather than the session, anonymous
  and deleted-user callers redirected, ADMIN and SUPER_ADMIN allowed, EDITOR
  metadata edit still allowed. Against the original code, 5 tests fail. Full
  run: `npm test` 481 passed, 0 failed, 2 skipped; render 264 passed;
  typecheck, lint, and `git diff --check` clean. Authorization tests: 69
  passed, 0 skipped (re-run before the commit).
- **Pending:** proof over a real HTTP Server Action call with a real session
  and database is part of P4-03 (BLOCKED, postponed by owner).
- **Evidence:** commit `379e53b761446af062e58364988b3c6151a3d9ac` (`fix(security): restrict media deletion to administrators`).
- **Security impact:** medium (an EDITOR can no longer destroy media).
- **Production impact:** none until published. After release, EDITORs lose
  media deletion: mistaken uploads wait for an ADMIN, and in ADR 0003's
  replacement flow an ADMIN retires the old image.

#### P1-08 — Password recovery and MFA decision
- **Status:** TODO (decision OD-03)
- **Acceptance:** documented decision; if approved, a task per feature.
- **Security impact:** high. **Production impact:** none until implemented.

#### P1-09 — Email verification decision
- **Status:** TODO (decision OD-15)
- **Files:** `src/server/auth/config.ts` (`requireEmailVerification`)
- **Security impact:** low to medium.

## Phase 2 — Core backend

#### P2-01 — CMS services
- **Status:** DONE · **Completed:** 2026-09-08 · **Release:** PUBLISHED
- **Requirements:** FR-CMS-01…06
- **Evidence:** `7a45337`, `c2e39dc`; stale-save and media-order fixes `8a59c19`; form fixes `cf8345c`, `c310487`; `cms.test.ts`, `project-version.test.ts`, `project-media.test.ts`; `cms:verify` (live; not re-run since).

#### P2-02 — Media pipeline
- **Status:** DONE · **Completed:** 2026-09-08 · **Release:** PUBLISHED
- **Requirements:** FR-MED-01, FR-MED-02
- **Evidence:** `e0a480d`, `cdc6963`; ADR 0003; `media.test.ts`; `media:verify` (needs R2; not re-run since).

#### P2-03 — Inquiry processing
- **Status:** DONE · **Completed:** 2026-09-08; hardening 2026-11-01
- **Release:** base PUBLISHED; hardening (`f37ff87`, `74bc665`) MAIN UNPUBLISHED
- **Requirements:** FR-INQ-01…05
- **Evidence:** `57a5100`, `8129fc4`, `4a6bc4e`, `0717cbc`, `8d0529d`, `f5e3b3c`, `f37ff87`, `74bc665`; `submit-inquiry.test.ts`, `crm.test.ts`.
- **Security impact:** high (PII intake), mitigated by the closed gate.

#### P2-04 — Email delivery and recovery
- **Status:** DONE · **Completed:** 2026-09-11; recovery 2026-11-01
- **Release:** base and retry PUBLISHED; recovery, claim races, and duplicate warning MAIN UNPUBLISHED
- **Requirements:** FR-INQ-04, FR-EML-01
- **Evidence:** `be88cd9`, `6b73253`, `12b279a`, `6b99eaf`, `541a363`, `1797766`; ADR 0007; `email.test.ts`, `recovery.test.ts`, `email-delivery-rows.render-test.ts`; `email:verify` (fake provider).

#### P2-05 — Inquiry rate limiting
- **Status:** DONE · **Completed:** 2026-09-12 · **Release:** PUBLISHED with DEF-03; build-time fail-closed LOCAL ONLY (`ce81964`)
- **Requirements:** FR-INQ-02
- **Evidence:** ADR 0008; `security.test.ts`, `rate-limit-production-build.test.ts`.

#### P2-06 — Turnstile production fail-closed (SD-13H)
- **Status:** DONE · **Completed:** 2026-11-03 · **Release:** LOCAL ONLY
- **Depends on:** P2-05 · **Requirements:** FR-INQ-02, NFR-SEC-03
- **Files:** `src/server/security/turnstile.ts`
- **Acceptance:** no development bypass in production bundles; missing keys
  refuse as misconfigured under any runtime `NODE_ENV`.
- **Tests:** `turnstile-production-build.test.ts` (8 tests fail against the pre-fix code); Next.js bundle inspection.
- **Evidence:** `be10fb4`.
- **Security impact:** high in principle; unreachable while intake is closed.
- **Production impact:** none until published.

#### P2-07 — Audit logging
- **Status:** DONE · **Release:** PUBLISHED. Cleanup TD-01 is open (P2-10).
- **Evidence:** `src/server/audit/audit-log.ts`; audit assertions in service tests.

#### P2-08 — Error handling
- **Status:** DONE · **Completed:** 2026-10-26; 2026-11-01
- **Evidence:** `8d1de49`, `29c5b6c`, `028beaa`, `74bc665`; `expected-errors.test.ts`.

#### P2-09 — Server-side monitoring runtime check (DEF-02)
- **Status:** DONE (offline verification) · **Completed:** 2026-11-03 · **Release:** LOCAL ONLY, committed locally as `b517fce` on `fix/sentry-production-initialization` (parent `99bc3dc`); not pushed, merged, or deployed.
- **Requirements:** NFR-OBS-01
- **Files:** `src/sentry.server.config.ts` (one line: `sentryInitOptions({ ...process.env, NODE_ENV: process.env.NODE_ENV })`),
  `src/lib/monitoring/server-init-production-build.test.ts` (new). `options.ts`, sampling,
  privacy settings, scrubbing, DSN validation, browser reporting, and Edge are unchanged.
- **Acceptance:** a production build initializes server reporting with a valid
  DSN under any runtime `NODE_ENV`; it stays off without a DSN, with a malformed
  DSN, and in a development build; DSN, environment, and release stay
  runtime-controlled; server and browser get identical privacy options; one
  server error is reported exactly once.
- **Tests:** 16 new production-build tests (11 fail against the old code);
  monitoring suites 45 passed; `npm test` 499 tests, 497 passed, 0 failed,
  2 skipped; render 264 passed; typecheck, lint, and offline `analytics:verify` pass.
- **Pending:** real event delivery is unverified until a Sentry account exists (P5-04).
- **Evidence:** commit `b517fce2f2acc24b16e23aba615e144e7895486e` (`fix(observability): stabilize production Sentry initialization`); the 16 regression tests passed again before the commit.
- **Security impact:** low (observability). **Production impact:** none until published and a DSN is configured.

#### P2-10 — Audit catalogue consistency (TD-01, TD-09)
- **Status:** TODO (decision OD-16 for the HTTP sign-in path)
- **Acceptance:** every written action is an `AuditAction` constant; the
  sign-in audit covers the agreed paths.

#### P2-11 — Make media deletion safe against concurrent assignment (DEF-04)
- **Status:** TODO. Needs design first; not implemented.
- **Depends on:** P1-07 · **Requirements:** FR-MED-02
- **Files (expected):** `src/server/media/service.ts`; possibly the project-save path in `src/server/cms/service.ts`.
- **Problem:** `deleteMedia` counts references, deletes the R2 objects, then
  deletes the row. An assignment committed in between leaves the row
  referenced while its objects are gone.
- **Prerequisites to occur:** an ADMIN deletes an unassigned image while another
  session assigns the same image to a project within the same short window.
- **Acceptance:** a documented design (for example a row lock or a tombstone
  state taken before object deletion, or row deletion before object deletion
  with an orphan-object sweep) that keeps ADR 0003's no-orphan intent or amends
  it in an ADR, and never leaves a referenced row without objects.
- **Required tests:** a concurrency test on real PostgreSQL (PGlite or a
  disposable branch) that interleaves assignment and deletion; R2 must be faked.
- **Security impact:** low (availability and integrity of content).
- **Production impact:** published projects could show broken images if the race occurs.

## Phase 3 — UI integration

#### P3-01 — Public pages and portfolio
- **Status:** DONE · **Completed:** 2026-09-08 (Phase 5) · **Release:** PUBLISHED
- **Requirements:** FR-PUB-01…07, FR-PUB-11
- **Evidence:** `c2e39dc`; ADR 0005; `public-content.test.ts`, `homepage.test.ts`; `public:verify` (live; not re-run since).

#### P3-02 — Contact page
- **Status:** DONE · **Completed:** 2026-10-31 · **Release:** PUBLISHED
- **Requirements:** FR-PUB-08
- **Evidence:** `6113ec9`, `288fde6`; `contact-sections.render-test.ts`.

#### P3-03 — Admin dashboard and CMS UI
- **Status:** DONE · **Completed:** 2026-09-08; usability and a11y 2026-10-26 · **Release:** PUBLISHED
- **Requirements:** FR-ADM-05, FR-CMS-*, FR-CRM-*
- **Evidence:** `7a45337`, `8d1de49`, `cf8345c`, `c310487`, `29c5b6c`, `153cd19`, `16f648e`, `028beaa`; admin render tests.

#### P3-04 — Responsive design
- **Status:** DONE in code; device verification UNVERIFIED
- **Requirements:** NFR-RESP-01 · **Evidence:** `16f648e`, `admin-mobile.render-test.ts`.

#### P3-05 — Accessibility
- **Status:** DONE in code; external audit TODO (OD-10)
- **Requirements:** NFR-A11Y-01 · **Evidence:** `153cd19`, `6850144`, `6251979`, `675be39`; `admin-a11y.render-test.ts`.

#### P3-06 — SEO, analytics hooks, observability
- **Status:** DONE · **Completed:** 2026-09-14 (Phase 9, `8d0529d`); Netlify foundation 2026-09-19 (Phase 10A, `f734d9b`) · **Release:** PUBLISHED
- **Requirements:** FR-PUB-10, NFR-SEO-01, NFR-OBS-01
- **Evidence:** ADR 0009, ADR 0010; `seo.test.ts`, `observability.test.ts`; `seo:verify`, `analytics:verify`, `deploy:verify` (offline).

#### P3-07 — Design-token consolidation
- **Status:** TODO (decisions OD-12, OD-13, OD-14)
- **Files:** `globals.css`, `contact.css`, components with inline values.
- **Acceptance:** one palette and named tokens for repeated sizes and tracking; no visual regression.

#### P3-08 — Legal content completion
- **Status:** BLOCKED on qualified legal review (REL-03)
- **Files:** `src/content/legal.tsx`
- **Acceptance:** all TODO markers replaced with real facts; approvals recorded
  only after a qualified reviewer approves. **Agents must never record an approval.**
- **Production impact:** opens the legal pages and, through the gate, inquiry intake.

#### P3-09 — Reliable admin photo upload: browser-side resize (MH-03 P0-2)
- **Status:** DONE (automated verification); real-browser checks PENDING · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `6b4f75d` on branch `feature/media-upload-resize` (parent `b84ab11`); not pushed, merged, or deployed.
- **Depends on:** — (client-side only) · **Requirements:** FR-MED-01
- **Files:** `src/lib/media-upload.ts` (new), `src/lib/media-upload.test.ts` (new),
  `src/app/(admin)/admin/media/upload-form.tsx`,
  `src/app/(admin)/admin/media/upload-form.render-test.ts`.
- **Scope:** before `POST /api/media`, a photo whose long edge exceeds 2560 px
  (the server's master cap) or whose size exceeds 4 MB is decoded upright in the
  browser (`createImageBitmap` with `imageOrientation: "from-image"`, falling
  back to an image element), downscaled in halving steps, and re-encoded: JPEG
  at quality 0.92 → 0.76 until it fits, PNG stays PNG, WebP stays WebP or falls
  back to PNG (transparency kept). Files that already fit are sent unchanged.
  Clear errors for unsupported types, unreadable large files, files still over
  4 MB, and a non-JSON platform 413. The 4 MB budget is a margin under the
  commonly documented Netlify function request limit (about 6 MB, UNVERIFIED).
  The server pipeline, `/api/media`, R2, authentication, and schema are unchanged.
- **Acceptance:** large camera JPEGs upload as 2560 px files within 4 MB; small
  files are sent untouched; failures read as alerts and the form recovers; the
  existing success, error, and notice-clearing behaviour is unchanged.
- **Tests:** `media-upload.test.ts` 20 passed (dimension fitting, upload
  decision, quality ladder, format retention, renaming, unreadable and
  undrawable images, resource release); `upload-form.render-test.ts` 10 passed
  (5 new mounted-form tests with a stub router and injected preparation).
  `npm test`: 542 tests, 540 passed, 0 failed, 2 skipped; render 270 passed;
  typecheck and lint clean; `npm run test:bundle` PASSED (56 and 32 passed,
  0 skipped, 0 network attempts; Node.js 22 run PENDING).
- **Pending (manual, real browsers):** Chrome, Safari, Firefox, and iOS Safari
  with an EXIF-rotated portrait JPEG, a 40–60 MP file, a transparent PNG, and an
  iPhone photo; colour fidelity of wide-gamut originals; the real Netlify
  request limit on an unpublished deploy (MH-01 A1). jsdom cannot decode or draw
  images, so the canvas codec is not covered by automated tests.
- **Security impact:** none; uploads still go through the authenticated route
  and server-side validation. **Production impact:** none until released.

#### P3-10 — Video MVP foundation: provider-independent helpers (MH-06)
- **Status:** DONE (unit level); not integrated · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed on branch `feature/video-mvp-foundation` (parent `6b4f75d`, P3-09); not pushed, merged, or deployed.
- **Depends on:** — (pure TypeScript; no Prisma, provider, or Netlify) · **Requirements:** FR-PUB-05; future video requirements (MH-03)
- **Files:** `src/lib/video-url.ts`, `src/lib/video-status.ts`,
  `src/lib/video-eligibility.ts`, `src/lib/video-messages.ts`, and one
  `*.test.ts` per module (all new). `src/lib/video.ts` is unchanged.
- **Scope:** YouTube and Vimeo link parsing (exact hosts, http(s) only, no
  credentials or ports, length cap; only provider, ID, and Vimeo hash leave
  it); the statuses UPLOAD_PENDING, PROCESSING, READY, FAILED, CANCELLED,
  DELETING, DELETE_FAILED with forward-only transitions (a repeated status is
  a no-op); title and provider-ID validation; public eligibility (READY and in
  at least one PUBLISHED project with an active category, mirroring
  `PUBLISHED_PROJECT_WHERE`); deletion eligibility; plain admin messages that
  never echo unknown or provider text.
- **Decisions (owner, MH-07):** a PROCESSING video may be deleted; an active
  upload (UPLOAD_PENDING) must be cancelled first; FAILED and CANCELLED videos
  may be deleted; http YouTube/Vimeo links may be parsed but generated playback
  URLs must use HTTPS; the provider-ID shape (alphanumeric, 10–128) and Vimeo
  hash shape (alphanumeric, 6–40) stay provisional until the provider trial.
- **Tests:** 36 passed (`video-url` 10, `video-status` 10, `video-eligibility`
  10, `video-messages` 6 tests). `npm test`: 578 tests, 576 passed, 0 failed,
  2 skipped; render 270 passed; typecheck and lint clean; `npm run test:bundle`
  PASSED (56 and 32 passed, 0 skipped, 0 network attempts; Node.js 22 run PENDING).
- **Remaining integration dependencies:** provider trial (MH-02D Task 5) to
  confirm Mux and the provisional ID and hash shapes; owner approval of
  dependencies (`@mux/upchunk`, `hls.js`); the `Video` and `ProjectVideo`
  schema and migration, tested on a disposable database (**P4-03 BLOCKED**);
  reconcile `src/lib/video.ts` (YouTube IDs stored as 6–32 characters vs the
  parser's 11, and the Vimeo embed does not yet pass the unlisted hash); wire
  the parser into the project form (MH-03 P0-10).
- **Security impact:** none until integrated. **Production impact:** none.

#### P3-11A — Video provider boundary: Mux configuration, client, webhook signature, playback token (MH-06)
- **Status:** DONE (unit level, mocked provider); not integrated · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `18a6f76` on branch `feature/video-upload-backend` (parent `e681ffa`, P3-10); not pushed, merged, or deployed.
- **Depends on:** P3-10 · **Requirements:** future video requirements (MH-03)
- **Files (all new, server-only):** `src/server/video/config.ts`,
  `src/server/video/errors.ts`, `src/server/video/secret.ts`,
  `src/server/video/mux-client.ts`, `src/server/video/webhook-signature.ts`,
  `src/server/video/playback-token.ts`, and tests for config, mux-client,
  webhook-signature, and playback-token.
- **Scope:** configuration from five variables (`MUX_TOKEN_ID`,
  `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`, `MUX_SIGNING_KEY_ID`,
  `MUX_SIGNING_PRIVATE_KEY`): none set means disabled, a partial or malformed
  set means invalid (problems name variables, never values); RSA ≥ 2048-bit
  signing key as PEM or base64 PEM. `Secret` wrapper redacts credentials in
  `String`, JSON, and `inspect`. A `fetch`-based Mux REST client (no SDK,
  injectable): direct upload create/get/cancel, asset get/delete, signed
  playback policy, `max_resolution_tier` 2160p by default, IDs validated before
  entering paths, redirects refused, 4 s time budget, response bodies of
  failures discarded; failures are `VideoProviderError` (code and HTTP status
  only) with a retryable classification. Webhook verification of
  `mux-signature` (HMAC-SHA256 over `t.rawBody`, constant-time, 300 s
  tolerance, several `v1` values for rotation). RS256 playback tokens
  (`sub`, `aud`, `exp`, `kid`; lifetime 60 s–24 h) and HTTPS
  `stream.mux.com` URLs.
- **Tests:** 37 passed (`config` 7, `mux-client` 16, `webhook-signature` 7,
  `playback-token` 7). `npm test`: 615 tests, 613 passed, 0 failed, 2
  skipped; render 270 passed; typecheck and lint clean; `git diff --check`
  clean. No network calls; credentials and keys in tests are fictional or
  generated per run.
- **Not done / UNVERIFIED:** the five variables are not yet in `.env.example`
  or [04_TRD.md](04_TRD.md) (added when a route uses them); request and claim
  details (`kid` placement, 2160p output, ID shapes) are confirmed only in the
  provider trial (MH-02D Task 5 / T-11).
- **Security impact:** none until integrated (no route uses it). **Production impact:** none.

#### P3-11B — Video upload, cancellation, webhook, and playback services (MH-06)
- **Status:** DONE (unit level, mocked provider, in-memory repository); not integrated · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `6868cbe` on branch `feature/video-upload-backend` (parent `18a6f76`, P3-11A); not pushed, merged, or deployed.
- **Depends on:** P3-10, P3-11A · **Requirements:** future video requirements (MH-03)
- **Files (all new, server-only):** `src/server/video/repository.ts`
  (`VideoRecord`, `VideoRepository` interface), `src/server/video/in-memory-repository.ts`
  (test implementation), `src/server/video/service.ts`, `src/server/video/service.test.ts`.
- **Scope:** `createVideoService(deps)` with injected repository, Mux client,
  signing config, clock, id generator, and a logger whose fields cannot carry
  secrets. `createUploadSession`: title, file name (base name; mp4, mov, m4v,
  mkv, webm), and declared size validated; 10 GiB default limit; two active
  (unexpired UPLOAD_PENDING) uploads per user, pre-checked before the provider
  call and enforced atomically on insert; the record is persisted before the
  URL is returned; the provider upload is cancelled when persistence fails or
  the race is lost; the URL is never stored or logged. `cancelUploadSession`:
  uploader or ADMIN/SUPER_ADMIN; provider first, then compare-and-set;
  idempotent; follows the provider's state when it refuses. `handleMuxWebhook`:
  1 MiB cap, signature verified before parsing, payload used only for type and
  IDs, upload and asset state re-read from Mux, ownership checked (asset
  `passthrough` = video id and `upload_id` = stored upload), forward-only
  compare-and-set transitions (UPLOAD_PENDING → PROCESSING → READY), CANCELLED,
  FAILED, DELETING, and DELETE_FAILED never become READY, orphan assets of
  cancelled uploads deleted at Mux, 503 for provider, persistence, or repeated
  write-conflict failures. `issuePlaybackToken`: READY with a signed playback
  ID; admins (any role) preview; the public only through a named project that
  is PUBLISHED with an active category; every public refusal is the same
  `not_found`; 15-minute RS256 token (configurable 60 s–24 h); HTTPS URL.
- **Tests:** `service.test.ts` 35 passed (upload 8, cancel 7, webhook 12,
  playback 6, configuration 2). `npm test`: 650 tests, 648 passed, 0 failed,
  2 skipped; render 270 passed; typecheck and lint clean; `git diff --check`
  clean. `npm run test:bundle`: PASSED (56 and 32 passed, 0 skipped, 0
  network attempts; full log captured). One earlier run reported 55 of 56:
  `docs/06_Plan.md` was edited during that run, which trips the suite's
  source-digest freshness assertion (`security.bundle-test.ts:144`); the
  failing test's name was not captured, so this cause is inferred.
  Node.js 22 run PENDING. No network or database access.
- **Limitations / UNVERIFIED:** the declared file size is not enforced by the
  provider; webhook deduplication is by reconciliation (no event-ID store, no
  schema); provider event types, `errors.type` values, the presence of
  `upload_id` on assets, and token behaviour mid-playback await the provider
  trial (MH-02D); the Prisma repository needs the `Video`/`ProjectVideo`
  schema (P4-03 BLOCKED) and must keep the atomic limit and compare-and-set
  guarantees; no routes, rate limiting, audit logging, or admin UI yet.
- **Next:** P3-11C (below).
- **Security impact:** none until routes exist. **Production impact:** none.

#### P3-11C — Video database adapter and API routes (MH-06, MH-07)
- **Status:** DONE (automated, offline: mocked Prisma client, in-memory repository, fake Mux); database integration **BLOCKED by P4-03** · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `b440dcf` on branch `feature/video-upload-backend` (parent `6868cbe`, P3-11B); not pushed, merged, or deployed. The migration file's trailing blank line was removed before the commit (content unchanged; never applied).
- **Depends on:** P3-11B · **Blocks:** P3-11D, the admin video UI, and any release containing these routes (the migration must be applied first)
- **Files (new):** `prisma/migrations/20261106120000_add_uploaded_video/migration.sql`;
  `src/server/video/prisma-repository.ts`, `rate-limit.ts`, `runtime.ts`,
  `http.ts`, `route-deps.ts`; routes `src/app/api/videos/uploads/route.ts`,
  `src/app/api/videos/uploads/[id]/cancel/route.ts`,
  `src/app/api/videos/[id]/playback/route.ts`, `src/app/api/webhooks/mux/route.ts`;
  tests `http.test.ts`, `prisma-repository.test.ts`, `runtime.test.ts`,
  `rate-limit.test.ts`, `video-schema.test.ts` (all in `src/server/video/`).
- **Files (changed):** `prisma/schema.prisma` (enum `VideoStatus`; models
  `Video`, `ProjectVideo`; relation fields on `User` and `Project`, no column
  changes); `src/server/video/service.ts` (`onTransition` audit hook);
  `src/server/video/repository.ts` (`fileSizeBytes` → `declaredSizeBytes`) and
  `service.test.ts` (same rename); `src/server/audit/audit-log.ts` (actions
  `video.upload_started`, `video.upload_cancelled`, `video.ready`,
  `video.processing_failed`; entity `video`); `.env.example` (five `MUX_*`
  names, empty); [04_TRD.md](04_TRD.md) §4, §5.1, §6, §8.4;
  [05_Schema.md](05_Schema.md) §8 (minimal, required by the task-update procedure).
- **Schema:** additive only (one enum, two tables, indexes, three foreign
  keys); generated offline with `prisma migrate diff --from-schema --to-schema`
  and a scratch Prisma config that loads no environment file and points at an
  unreachable placeholder URL. **Not applied; `migrate dev`/`deploy` not run.**
- **Repository guarantees:** two-active-upload limit enforced in one
  transaction under `pg_advisory_xact_lock` keyed per uploader (count, then
  insert); transitions are a single `UPDATE … WHERE id AND status` (stale
  webhooks change nothing); identity and ownership columns cannot be patched;
  `lockVideoRowSql` (`SELECT … FOR UPDATE`) and the `project_video → video`
  `RESTRICT` key prepare deletion and assignment (P3-11D). The in-memory
  repository's guarantees are unchanged. Implemented by the standard pattern;
  **UNVERIFIED against PostgreSQL** until P4-03.
- **Routes:** see [04_TRD.md](04_TRD.md) §5.1. Upload and cancel: exact
  `Origin` = `BETTER_AUTH_URL` (and same-origin `Sec-Fetch-Site`), session,
  ADMIN/SUPER_ADMIN, configuration, rate limit, then JSON body ≤ 4 KB.
  Webhook: exact raw bytes verified before parsing. Playback: public only with
  `projectId` of a PUBLISHED project in an active category, one identical 404
  otherwise; admin preview with a session. All responses `private, no-store`.
  Missing or partial `MUX_*` configuration fails closed (503).
- **Tests:** video tests 119 passed (new: `http` 22, `prisma-repository` 13,
  `runtime` 5, `rate-limit` 4, `video-schema` 3). A deliberate mutation
  (count before lock) failed the two lock tests, so the concurrency test
  detects that regression. `npm test`: 697 tests, 695 passed, 0 failed, 2
  skipped; render 270 passed; typecheck and lint clean; `git diff --check`
  clean; `npm run test:bundle` PASSED (56 and 32 passed, 0 skipped, 0 network
  attempts; full log captured). Pre-commit re-run (P3-11D Part A, same
  counts): `npm test` 697 / 695 passed / 0 failed / 2 skipped, render 270
  passed, typecheck, lint, `git diff --check` clean, `test:bundle` PASSED (56
  and 32, 0 network attempts). The four compiled route outputs were inspected
  in a kept bundle workspace: each is `force-dynamic` on the Node.js runtime;
  the shared handler chunk reads the `MUX_*` names from `process.env` at
  runtime (no inlined values), keeps the origin and `mux-signature` checks, and
  sets `private, no-store, max-age=0`. Node.js 22 run PENDING. No database, no Mux.
- **Blockers and limitations:** P4-03 (apply the migration and run the
  repository against a disposable database, including concurrent inserts and
  stale updates); provider trial MH-02D (event types, `errors.type`,
  `upload_id` on assets, token expiry mid-playback, Netlify delivering raw
  webhook bytes unchanged); the declared file size is not enforced by Mux;
  the admin UI must add the Mux upload host to the CSP `connect-src`
  (UNVERIFIED host); public playback needs the project id from the page;
  webhook deduplication remains by reconciliation.
- **Security impact:** new authenticated and public endpoints, inert until all
  five `MUX_*` variables are configured. **Production impact:** none until
  released; releasing requires the migration first.

#### P3-11D — Admin video library: upload, preview, cancel, and delete (MH-03, MH-06, MH-07)
- **Status:** DONE (automated, offline: in-memory repository, fake Mux, fake UpChunk and hls.js, jsdom); real browsers, real Mux, and database integration UNVERIFIED (MH-02D trial; **P4-03 BLOCKED**) · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `cd79df9` on `feature/video-upload-backend` (parent `b440dcf`, P3-11C); not pushed, merged, or deployed.
- **Pre-commit review (P3-11E Part A, 2026-11-06):** retrying deletion after a provider 404 is safe: the asset ID stays on the row until the row is removed, so a retry calls the provider again and its 404 counts as already deleted (the test now asserts both provider calls). Residual risk: a 404 caused by credentials for the wrong Mux environment would also count as deleted and leave the asset at Mux (signed playback only, so not viewable). Re-run: `npm test` 763 tests, 761 passed, 0 failed, 2 skipped; render 288 passed; typecheck, lint, `git diff --check` clean; `npm run test:bundle` PASSED first time (56/56, 32/32, 0 network attempts; Node 22 PENDING).
- **Depends on:** P3-11C (done) · **Blocks:** project assignment of videos and public video on project pages (not started; no task yet)
- **Dependencies added (owner-authorized in the task):** `@mux/upchunk` 3.5.0 and `hls.js` 1.7.4, pinned exactly. Reviewed: licences MIT and Apache-2.0; UpChunk pulls `xhr` (`global` → `min-document`, `process`; `once`; `parse-headers`) and `event-target-shim`, all MIT; hls.js has no runtime dependencies; `npm audit` reports no advisory for any of them. Both load on demand only (upload start, Play).
- **Files (new):** `src/app/(admin)/admin/videos/page.tsx`, `video-library.tsx`, `video-library.render-test.ts`;
  `src/app/api/videos/[id]/route.ts` (`DELETE`); `src/components/video/hls-player.tsx`;
  `src/lib/video-csp.ts`, `video-library.ts`, `video-upload.ts` and their tests;
  `src/server/video/admin-library.ts`, `admin-library.test.ts`, `delete.test.ts`, `prisma-repository-delete.test.ts`.
- **Files (changed):** `src/server/video/repository.ts`, `in-memory-repository.ts`,
  `prisma-repository.ts` (`listForAdmin`, `beginDeletion`, `deleteIfDeleting`;
  `lockVideoRowSql` also selects `updatedAt`); `service.ts` (`deleteVideo`;
  admin preview limited to ADMIN/SUPER_ADMIN); `http.ts` (`handleDeleteVideo`;
  EDITOR preview 403); `rate-limit.ts` (`delete` 30/10 min); `route-deps.ts`
  (`loadAdminVideoLibrary`); `src/server/audit/audit-log.ts` (`video.deleted`,
  `video.delete_failed`); `src/lib/security-headers.ts` and `next.config.ts`
  (policy for `/admin/videos` only); `src/components/admin/admin-links.ts`
  (Videos link, ADMIN only); `service.test.ts` and `http.test.ts` (preview rule,
  new cases); `.env.example` (`VIDEO_UPLOAD_ORIGIN`, `VIDEO_PLAYBACK_ORIGINS`,
  empty); `package.json`, `package-lock.json`; 02_AppFlow, 03_UI_Spec, 04_TRD,
  05_Schema.
- **Schema:** unchanged. Safe deletion needed only repository changes (row
  lock + assignment count + DELETING claim in one transaction; conditional row
  delete), described in [05_Schema.md](05_Schema.md) §8.
- **Behaviour:** see [02_AppFlow.md](02_AppFlow.md) SCR-ADM-07V and
  [04_TRD.md](04_TRD.md) §5.1. Deletion order: claim DELETING → delete the Mux
  asset (found through the upload when no asset ID is stored; already gone
  counts as deleted) → remove the row. Any failure after the claim leaves
  DELETE_FAILED (Retry delete); a stale DELETING claim (5 min) may be retried.
  Webhooks never change DELETING or DELETE_FAILED; playback refuses them.
- **Behaviour change to P3-11C:** admin preview (`GET /api/videos/[id]/playback`
  without `projectId`) now requires ADMIN or SUPER_ADMIN; an EDITOR gets 403.
  Two P3-11B/C tests were updated to the new rule and assert the refusal.
- **CSP:** the global policy is byte-for-byte unchanged (tested against a fixed
  baseline). `/admin/videos` alone adds `https://stream.mux.com` and
  `VIDEO_PLAYBACK_ORIGINS` to `connect-src` and `media-src` (plus `blob:` for
  Media Source Extensions) and `VIDEO_UPLOAD_ORIGIN` to `connect-src`; no
  wildcard, no `worker-src` (hls.js runs without a worker). The Mux CSP guide
  URL returned 404 and the direct-upload guide names no host, so the upload and
  segment hosts are **UNVERIFIED**: uploads stay disabled until
  `VIDEO_UPLOAD_ORIGIN` is set, and the browser refuses an upload URL on any
  other origin.
- **Tests:** video and video-UI tests 221 passed in `src/server/video` and
  `src/lib/video*` (new or extended: `delete` 17, `http` 30 (+8),
  `prisma-repository-delete` 7, `service` 36 (+1), `video-library` 6,
  `video-upload` 12, `video-csp` 8, `admin-library` 7) and render
  `video-library.render-test.ts` 18. Mutation checks: skipping the delete
  confirmation failed 1 render test; removing the assigned-video refusal failed
  2 deletion tests. `npm test`: 763 tests, 761 passed, 0 failed, 2 skipped;
  render 288 passed; typecheck and lint clean; `git diff --check` clean;
  `npm run test:bundle` (Node.js 24.13.0): first run FAILED 55 of 56 in the
  bundle suite (SD-13E "six failed attempts, then refuses the seventh"); it
  finished at about 17:45:00, a 15-minute window boundary, and the test's fake
  bucket counter keys on the real clock's window start, so the seventh attempt
  fell into a new window (pre-existing timing flake, no auth or limiter file
  changed; recorded as a defect candidate for the test, not fixed here).
  Immediate re-run PASSED: 56 and 32 passed, 0 skipped, 0 network attempts.
  The compiled output contains `/api/videos/[id]/route` and the
  `/admin/videos` page; `routes-manifest.json` holds the global policy for
  `/:path*` unchanged and the widened policy for `/admin/videos` after it; no
  client chunk names a `MUX_` variable. Node.js 22 run PENDING. No database,
  no Mux, no real upload.
- **Remaining before the client can use it:** (1) apply the P3-11C migration
  (P4-03, then production with authorization); (2) provider trial MH-02D:
  confirm the direct-upload host and segment hosts, set `VIDEO_UPLOAD_ORIGIN`
  and, if needed, `VIDEO_PLAYBACK_ORIGINS` (build-time), confirm that the later
  header entry replaces the global CSP on a deploy preview, and check event
  types and token expiry mid-playback; (3) configure the five `MUX_*`
  variables and the Mux webhook to `/api/webhooks/mux`; (4) real-browser checks
  (Chrome, Firefox, Safari, iOS Safari: chunked upload of a multi-GB file,
  cancel, resume after a network drop, preview); (5) owner review, commit,
  merge, and release. Not built here: assigning videos to projects and public
  video on project pages (the player supports `projectId`, and the route
  already refuses draft projects).
- **Security impact:** one new authenticated destructive endpoint behind the
  same gate as uploads; an admin page; a wider CSP on that page only.
  **Production impact:** none until released; inert without `MUX_*`.

#### P3-11E — Project video assignment and public Films (MH-03, MH-06, MH-07)
- **Status:** DONE (automated, offline: fake database with row locks, fake fetch, jsdom); PostgreSQL locking and real playback UNVERIFIED (**P4-03 BLOCKED**, MH-02D trial) · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY. Committed as `186d489` on `feature/video-upload-backend` (parent `cd79df9`, P3-11D); not pushed, merged, or deployed.
- **Part A (P3-11D finalised):** reviewed; retry after a provider 404 confirmed safe and asserted; checks re-run (see P3-11D); committed as `cd79df9`.
- **Depends on:** P3-11D (done) · **Blocks:** release of uploaded video (with P4-03, MH-02D)
- **Files (new):** `src/server/cms/project-save.ts` (+ `project-save.test.ts`), `src/lib/cms/project-videos.ts` (+ test), `src/components/admin/project-video-picker.tsx` (+ render test), `src/components/public/project-films.tsx` (+ render test).
- **Files (changed):** `src/server/cms/service.ts` (`saveProject` delegates to `runProjectSave`; `ProjectConflictError` moved, re-exported; audit `project.videos_changed`); `src/app/(admin)/admin/cms-actions.ts` (`videoIds` only when the form has the video section; `ProjectVideoAssignmentError` shown to the editor); `src/lib/validation/cms.ts` (`videoIds`: uuids, unique, at most 20, optional); `src/components/admin/project-form.tsx`, `src/app/(admin)/admin/projects/[id]/page.tsx`, `.../new/page.tsx` (video section; READY library loaded for ADMIN/SUPER_ADMIN only, display columns only); `src/server/public/queries.ts`, `mappers.ts`, `view-models.ts` (`films`); `src/app/(public)/work/[slug]/page.tsx` (Films section); `src/lib/security-headers.ts`, `next.config.ts` (`/work/:slug` playback CSP); `src/server/audit/audit-log.ts`; tests `public-content.test.ts` (+5), `service.test.ts` (+1), `video-csp.test.ts` (+2); docs 02–05.
- **Schema:** unchanged (`project_video` exists since P3-11C). Locking described in [05_Schema.md](05_Schema.md) §8.
- **Decisions in this task:** (1) only ADMIN and SUPER_ADMIN change video assignments, matching the ADMIN-only library; an EDITOR still saves projects, and the server ignores any video ids an EDITOR submits. (2) Every submitted video must be READY at lock time, including ones already attached (an assigned video cannot leave READY). (3) The public detail exposes our own video and project UUIDs (needed by the existing playback route); no provider id, playback id, or token. (4) `/work/:slug` gets a playback-only CSP for every project page, because headers are static.
- **Tests:** `project-save.test.ts` 27 (READY add in order within the project transaction; six non-READY statuses refused with full rollback; unknown id; validation; remove without delete; empty removal; reorder; no-op; shared video across projects; EDITOR and no-section saves untouched; `saveProject` derives `manageVideos` from `isAdministrative(actor.role)`; new project; images identical with and without videos; stale version first; assignment-first and deletion-first races against the real `beginDeletion`; 60 random interleavings with the invariant "never assigned and not READY"); `project-videos.test.ts` 8; `public-content.test.ts` +5 (order, READY filter, no provider data, YouTube/Vimeo kept); `service.test.ts` +1 (unpublish or category hide stops playback at once, shared video stays playable through the other project); `video-csp.test.ts` +2; render `project-video-picker` 8 and `project-films` 4 (no request before Play; request carries `projectId`; server HTML holds no URL, token, or `<video>`). Mutation check: removing `FOR UPDATE` from the assignment lock failed 4 tests, including both race tests. `npm test`: 806 tests, 804 passed, 0 failed, 2 skipped; render 300 passed; typecheck, lint, `git diff --check` clean (MH-08 pre-commit run). `npm run test:bundle` PASSED three times (56/56, 32/32, 0 network attempts; Node 22 PENDING); the kept build's `routes-manifest` shows `/:path*` unchanged and `/work/:slug` with `connect-src … https://stream.mux.com` and `media-src 'self' blob: https://stream.mux.com`; the five `MUX_*` names appear in no client chunk.
- **BLOCKED:** the PostgreSQL proof that `FOR UPDATE` in the save and in `beginDeletion` serialise as modelled (two real concurrent transactions, both orders) needs the disposable database (P4-03). Not claimed as verified.
- **Security review (no upgrade, as instructed):** `npm audit` marks `better-auth` 1.7.3 critical through three advisories, all fixed in 1.7.7 (npm offers 1.7.18, not semver-major): GHSA-965c-763c-88jm / CVE-2026-114607 (critical 9.1; OAuth state usable as a Magic Link token; needs the Magic Link plugin and a social or Generic OAuth provider), GHSA-r4xp-prcw-77qf (high 7.4; needs the OAuth Proxy plugin with cookie-stored state), GHSA-44jh-23m7-hpcf (low 3.7; database-stored Better Auth rate limits on the Drizzle or Kysely adapter). `src/server/auth/config.ts` uses email and password only, the Prisma adapter, `nextCookies`, no social or OAuth provider, no Magic Link, no OAuth Proxy, no Better Auth rate-limit storage: **not affected** by any, per the advisory texts. Recommended: upgrade to the latest 1.7.x (≥ 1.7.7) in a separate task with the auth test suite and bundle tests; add a review step before any OAuth or Magic Link plugin is enabled.
- **Production impact:** none until released; Films render only for assigned READY videos.

#### MH-08 — Finalise the video MVP and prepare integration testing
- **Status:** Part A DONE (P3-11E committed as `186d489`); Part B DONE (Better Auth 1.7.18; committed under MH-09, hash recorded there); Part C DONE (checklist) · **Completed:** 2026-11-06 · **Release:** LOCAL ONLY; not pushed, merged, or deployed.
- **Part A review:** the working tree held only the 29 P3-11E files. The EDITOR gate is `manageVideos: isAdministrative(actor.role)` in `saveProject` (a test now pins it). Both locks are `FOR UPDATE` on the same `"video"` row by `"id"` (`lockVideoRowSql` and `lockVideosForAssignmentSql`). The public HTML holds no provider ID, playback ID, or token, and structured data does not read films. Pre-commit: `npm test` 806 tests, 804 passed, 0 failed, 2 skipped; render 300 passed; typecheck, lint, `git diff --check` clean; `test:bundle` PASSED (56/56, 32/32, 0 network attempts).
- **Part B (Better Auth):** `better-auth` 1.7.3 → **1.7.18** (latest 1.7.x; patched since 1.7.7), pinned exactly. The lockfile changes only Better Auth's own tree: `@better-auth/*` 1.7.18, `@better-auth/utils` 0.5.1, `better-call` 1.4.5, `@better-fetch/fetch` 1.3.3, `jose` 6.2.15, `kysely` 0.29.8, `nanostores` 1.5.5, `set-cookie-parser` 3.2.2 (no other dependant). Peers satisfied (Next 15, React 19, Prisma 7, zod 4.6.7). The 1.7.4–1.7.18 release notes list no breaking change and no schema change for this configuration. Checked against the code: the login guard only returns or throws (the 1.7.15 `hooks.before` header fix does not apply); session cookie names and attributes are unchanged (`__Secure-better-auth.session_token`, Secure, HttpOnly, SameSite=Lax, Path=/, 8 h); the middleware uses the library's `getSessionCookie`. Expected visible change: passwords over 128 characters are refused with `PASSWORD_TOO_LONG` before verification (1.7.6), which still reaches the user as the generic failure. Tests: auth, authorization, and rate-limit suites 164 tests, 162 passed, 0 failed, 2 skipped (production-build checks); `npm test` 806 tests, 804 passed, 0 failed, 2 skipped; render 300 passed; typecheck, lint clean; `test:bundle` PASSED (56/56, 32/32, including the real-bundle auth and Edge middleware checks). `npm audit`: critical 1 → 0 (low 4, moderate 11 remain, pre-existing, unrelated). Real sign-in against a database is UNVERIFIED (P4-03).
- **Part C:** [VIDEO_INTEGRATION_CHECKLIST.md](VIDEO_INTEGRATION_CHECKLIST.md), with the owner-authorized steps marked.
- **Remaining blockers:** P4-03 (disposable database: migration, rollback, PostgreSQL concurrency tests, integration suites); MH-02D (Mux test environment, credentials, webhook, host confirmation, CSP on a deploy preview); real-browser and 4K testing; merge, production migration, and release (all owner-authorized).

#### MH-09 — Commit the security update and prepare video integration verification
- **Status:** Part A DONE (committed as `624250f`); Part B DONE offline, database run **NOT RUN** (**P4-03 BLOCKED**); Part C DONE · **Completed:** 2026-11-07 · **Release:** LOCAL ONLY. Parts B and C committed as `ff52e44` on `feature/video-upload-backend` (parent `624250f`); nothing pushed, merged, or deployed.
- **Part A:** the working tree held only `package.json`, `package-lock.json`, `docs/04_TRD.md`, `docs/06_Plan.md`, and the new checklist. Lockfile diff, compared package by package: only Better Auth's tree changed (versions as recorded under MH-08) plus a `peer: true` flag on the existing `zod` 4.6.7 entry; no other dependant. `npm audit`: the three advisories (GHSA-965c-763c-88jm, GHSA-r4xp-prcw-77qf, GHSA-44jh-23m7-hpcf) are no longer reported; 0 critical, 0 high (low 4, moderate 11, pre-existing). Pre-commit: auth and security suites 127 tests, 125 passed, 0 failed, 2 skipped (production-build checks); `npm test` 806 tests, 804 passed, 0 failed, 2 skipped; render 300 passed; typecheck, lint, `git diff --check` clean; `test:bundle` PASSED (56/56, 32/32, 0 network attempts; Node 22 PENDING). Committed as `624250f` (parent `186d489`).
- **Part B files (new):** `scripts/integration/video-target.ts` (offline target rules), `video-suite-gate.ts` (first import; exits before a driver loads), `video.integration.ts` (26 tests in 7 groups: migration, uploads and limit, transitions, webhooks, assignment versus deletion, shared-video deletion, save rollback), `video-target.test.ts` (20 offline tests). **Changed:** `scripts/integration/run.ts` runs the suite serially inside `integration:run`, after identity, marker, and migrations, with the network guard and the confirmation `VIDEO_INTEGRATION_CONFIRM_BRANCH`.
- **Refusals (offline-tested):** missing or empty disposable keys; no or wrong branch confirmation; the declared production endpoint; URLs on different or undeclared endpoints, non-Neon hosts, `sslmode` other than require/verify, host overrides; any other database variable (`PG*`, `POSTGRES_*`, `*DATABASE_URL*`); `NODE_ENV=production`, Netlify or a production context; production-like database, role, or project names. At run time, one read-only transaction refuses an empty, unmarked, or differently migrated database. The suite, started with a scrubbed environment and the network guard, exits 1 with the refusal and runs no test (tested).
- **Design notes:** Mux is a local fake. The migration test replays every earlier migration in a scratch schema on one direct session, so `public` is never altered; it checks the checklist's `DROP` rollback restores the schema and data exactly. Lock-ordering tests use a separate session holding `FOR UPDATE` (or the advisory lock) and wait in `pg_stat_activity` for the expected waiters. All rows carry a run tag and are removed afterwards.
- **Tests:** `npm test` 826 tests, 824 passed, 0 failed, 2 skipped; render 300 passed; typecheck, lint, `git diff --check` clean. `video.integration.ts` **NOT RUN** (needs P4-03).
- **Part C:** [VIDEO_INTEGRATION_CHECKLIST.md](VIDEO_INTEGRATION_CHECKLIST.md) section 2 now describes the written suite; new section 12 separates feature disablement, application rollback, database rollback (export Mux asset IDs before `DROP`), and Mux asset cleanup; a table lists the owner approval for each real external operation.
- **Follow-up (2026-11-07, uncommitted):** the harness protected only `PRODUCTION_DATABASE_ENDPOINT`. A new required key, `PROTECTED_DEVELOPMENT_ENDPOINT`, is now refused independently as the disposable endpoint and in either URL (`identity.ts`), and is passed to the video suite (`run.ts`). Tests: `identity.test.ts` +3, `video-target.test.ts` +2 (46/46 in the two files); a mutation removing the development checks failed 3 tests.
- **Next owner action:** P4-03: create a disposable Neon project or branch, then authorize `integration:preflight`, `integration:identity`, and `integration:run` against it.
- **Production impact:** none.

#### MH-10 — Replace uploaded video with external embeds (YouTube, Vimeo, Google Drive)
- **Status:** DONE locally (automated, offline) · **Completed:** 2026-11-07 · **Release:** LOCAL ONLY: committed as `f10cb7d` on `feature/external-video` (parent `d6dcb31`); migration NOT APPLIED; not pushed, merged, or deployed. Decision: [ADR 0012](DECISIONS/0012-external-video-embeds.md).
- **Removed:** the Mux implementation (P3-11A–E): `src/server/video/*`, `/api/videos/*`, `/api/webhooks/mux`, `/admin/videos`, project video picker, public Films, HLS player, the upload/CSP/status/eligibility/message helpers, the video parts of the project save and public queries, the video integration suite and its gate, `@mux/upchunk` and `hls.js` (lockfile: deletions only), the `MUX_*`/`VIDEO_*` variables, the `Video`/`ProjectVideo` models and `VideoStatus`. Files modified by the Mux commits were restored to their pre-Mux state (`e681ffa`); no later commit had touched them.
- **Withdrawn migration:** `20261106120000_add_uploaded_video` removed from the directory. Evidence it was never applied to a retained database: the authorized read-only `prisma migrate status` against the production endpoint (`ep-dawn-paper-b1l0y54j`) on 2026-11-07 listed it as the only pending migration; no other database is configured.
- **Added:** `GOOGLE_DRIVE` on `VideoProvider`, migration `20261107120000_add_google_drive_video_provider` (one `ALTER TYPE … ADD VALUE`; equals an offline `prisma migrate diff` from the 7-migration schema). Drive links (`/file/d/<id>/…`, `open?id=`, `uc?id=`) parsed with exact hosts and a validated file ID; embed `https://drive.google.com/file/d/<id>/preview`. The project form takes one **Video link** (`videoUrl`) with live provider detection and a click-to-load preview (`project-video-field.tsx`); the server stores only provider, ID, and title. The public player shows the project cover as a lazy, decorative poster. CSP: `https://drive.google.com` added to `frame-src` only. Unlisted Vimeo links are refused (hash not stored). The homepage showreel keeps provider-and-ID input.
- **Kept:** the integration harness's `PROTECTED_DEVELOPMENT_ENDPOINT` safeguard (MH-09 follow-up).
- **Tests:** new `external-video.test.ts` (11), `video-player.render-test.ts` +3, `project-video-field.render-test.ts` (3); `form-state.test.ts` updated. `npm test`: 566 tests, 564 passed, 0 failed, 2 skipped; render 276 passed (the drop from 832/300 is the removed Mux suites); typecheck, lint, `git diff --check` clean; `test:bundle` (compile-only production build) PASSED 56/56 and 32/32. A full `next build` was not run: it pre-renders from the database and the only configured database is production.
- **Remaining (owner-authorized):** backup, apply the migration, merge and push, publish, smoke test ([checklist](VIDEO_INTEGRATION_CHECKLIST.md)). Real-browser Drive playback (desktop and mobile) UNVERIFIED.
- **Production impact:** none until released.

## Phase 4 — Edge cases and testing

#### P4-01 — Unit and render suites
- **Status:** DONE · **Last verified:** 2026-11-06 at `b1a579d` plus uncommitted RR-03 changes (with RR-03C)
- **Evidence:** `npm test`: 522 tests, 520 passed, 0 failed, 2 skipped (the two real-bundle checks, which run in `npm run test:bundle`, P4-14); render 264 passed; typecheck and lint clean. Earlier: 505 tests, 503 passed, 2 skipped (RR-03, 2026-11-04); 472 passed, 2 skipped at `4f7f564`.

#### P4-02 — Integration harness implementation (SD-13I)
- **Status:** DONE · **Completed:** 2026-11-03 · **Release:** LOCAL ONLY
- **Files:** `scripts/integration/*`, `package.json` scripts `integration:*`
- **Acceptance:** fails closed on checkout, environment file, target identity,
  and database state; network guard; suites written.
- **Tests:** `scripts/integration/identity.test.ts` (21 passing); offline
  preflight refusals demonstrated.
- **Evidence:** `4f7f564`.
- **Security impact:** protects production from test runs. **Production impact:** none.

#### P4-03 — Database-backed integration verification
- **Status:** **BLOCKED: POSTPONED BY OWNER**
- **Depends on:** P4-02; a separate disposable Neon project and branch created
  by the owner; explicit authorization for `integration:identity` and then
  `integration:run`.
- **Requirements:** REL-02
- **Acceptance:** `integration:identity` reports an empty database contacting
  only the declared hosts; the owner confirms project, branch, and endpoint in
  the Neon Console; `integration:run` passes every step; the branch is deleted
  afterwards.
- **Tests covered:** login and logout, generic errors, account and client
  limits, concurrency, session expiry, roles, missing-secret and database-down
  refusal, closed gate through the real Server Action, Turnstile, inquiry
  limits, limit separation, log hygiene, full build with bundle checks; and
  (MH-09) the video PostgreSQL suite `scripts/integration/video.integration.ts`.
- **Security impact:** high (the only end-to-end proof of SD-13E/G/H).
- **Production impact:** none (disposable infrastructure only).

#### P4-04 — Concurrency
- **Status:** DONE at unit level (PGlite atomic increments; customer upsert
  retry). Database-backed proof BLOCKED (P4-03).

#### P4-05 — Authentication failure paths
- **Status:** DONE at unit level (`login-rate-limit.test.ts`, real Better Auth in memory). Live: BLOCKED (P4-03).

#### P4-06 — Database failure paths
- **Status:** DONE at unit level (storage failure → 503; workflow error categories). Live: BLOCKED (P4-03).

#### P4-07 — Media failure paths
- **Status:** DONE at unit level (`media.test.ts`). Live `media:verify` against R2: UNVERIFIED since Phase 3.

#### P4-08 — Email recovery
- **Status:** DONE (`recovery.test.ts`, `email.test.ts`, `email:verify` with a fake provider).

#### P4-09 — Inquiry gate
- **Status:** DONE (`draft-status.render-test.ts`, `submit-inquiry.test.ts`, the production-build workflow test).

#### P4-10 — Production build
- **Status:** compile-only DONE (2026-11-03, Node 22.23.4: no fallback key, no
  Turnstile bypass in server bundles). Compile-only verification repeated at
  `b1a579d` on 2026-11-04 (RR-02, Node 24.13.0) and made reproducible offline
  by P4-14. **Full build BLOCKED**: static generation needs a database (P4-03).

#### P4-11 — Security regression suites
- **Status:** DONE (`*production-build.test.ts`, `security.test.ts`; real-bundle
  checks through P4-14).

#### P4-14 — Offline production-bundle security tests (RR-02, RR-03, RR-03C)
- **Status:** DONE (offline verification; Node.js 22 run PENDING) · **Completed:** 2026-11-04; RR-03C safety corrections 2026-11-06 · **Release:** LOCAL ONLY, uncommitted on `fix/sentry-production-initialization` (from `b1a579d`); not pushed, merged, or deployed.
- **Depends on:** P4-10 (compile mode), P4-11
- **Requirements:** NFR-SEC-03, NFR-OBS-01
- **RR-02 (2026-11-04, verification only, no file changes):** the real Next.js
  15.5.28 compile-only build of `b1a579d` (isolated copy, no `.env*` file,
  mocked fonts, no database) was executed module by module: 55 checks passed,
  0 failed, covering SD-13E, SD-13G, SD-13H, DEF-01, DEF-02, and SEC-03
  `useSecureCookies`. The 9 security test files gave 158 passed, 0 failed,
  2 skipped; `npm test` 497 passed, 0 failed, 2 skipped; render 264 passed.
  Ran on Node.js 24.13.0, because Node.js 22 is not installed locally.
- **Files (RR-03):** `scripts/bundle/run.ts`, `scripts/bundle/next-server-runtime.ts`,
  `scripts/bundle/security.bundle-test.ts`, `scripts/bundle/workspace.ts`,
  `scripts/bundle/workspace.test.ts`, `scripts/bundle/offline-guard.mjs`,
  `package.json` (`test:bundle`), and the bundle-directory option in
  `src/server/security/rate-limit-production-build.test.ts` and
  `turnstile-production-build.test.ts`. No application code changed.
- **Acceptance:** `npm run test:bundle` builds the working tree with the real
  Next.js compiler (compile mode) in a temporary directory without any private
  environment file, credentials, database, or network; runs the bundle suite
  and the two formerly skipped real-bundle checks against that output; and
  fails on any failed, skipped, todo, or cancelled test or network attempt.
- **RR-03C (2026-11-06), from the RR-03B review:**
  - **R1, interruption cleanup** (`run.ts`, `workspace.ts`): SIGINT and SIGTERM
    handlers (persistent, not `once`) only record the signal and stop the active
    child; the main flow notices at its next await, unwinds through one
    `finally`, and exits 130 or 143. A second signal force-stops the child and
    never re-enters cleanup. `cleanupWorkspace` touches only a validated
    `munir-bundle-*` child of the temporary directory that does not overlap the
    repository, removes `app/node_modules` only if it is a junction or symlink
    (as a link, never through it), and deletes the workspace only after a
    no-follow scan finds no link left in it; otherwise it reports the location.
    A missing link (partial initialization) is fine. Workspaces from earlier
    runs are listed, flagged if they still hold a link, and never deleted.
  - **R2, test-process isolation** (`workspace.ts`, called at load in
    `security.bundle-test.ts` and both real-bundle check files): fails the file
    unless the guard marker is set, `fetch`, `WebSocket`, and
    `net.Socket#connect` are the guard's hooks, and a TCP probe to
    `offline-guard-self-test.invalid` is refused synchronously; no variable whose
    name marks a credential or service (database URLs, secrets, tokens, DSNs,
    `R2_`, `AWS_`, `NEON_`, `NETLIFY_`, `PG*`, and others) is present; and
    `BUNDLE_TEST_CONFIGURATION=fictional-only` and the guard preload are set.
    Messages name variables, never values. The runner counts the probe as a
    self-test, not a network attempt, and fails unless every test process
    (3) recorded one, in addition to the build-process guard check.
  - **D1:** document headers use durable wording (locally maintained draft;
    no owner approval, push, or deployment implied).
- **Tests:** `npm run test:bundle` (2026-11-06, Node.js 24.13.0): bundle suite
  56 passed, 0 failed, 0 skipped; formerly skipped real-bundle checks 32 passed,
  0 failed, **0 skipped** (both skip in `npm test` by design); offline guard
  loaded in 19 processes, 0 network attempts; in-process isolation self-test
  passed in 3 of 3 test processes; PASSED. Earlier runs: guard loaded in 18–21
  processes, 0 network attempts in any run. `scripts/bundle/workspace.test.ts`:
  23 passed (cleanup against a real junction, refusal cases, and isolation
  checks in guarded and unguarded child processes).
  Interruption (local hook `BUNDLE_RUNNER_SELF_TEST_SIGNAL`, which delivers the
  signal twice to the runner's own handlers during the real build): SIGINT
  exit 130 and SIGTERM exit 143, each with "received again" handled, link
  removed, workspace deleted, repository `node_modules` intact, no leftover
  build process. Isolation failure: each of the three bundle test files, run
  outside the runner, FAILED at load without the guard and, with the guard,
  when given a fictional `DATABASE_URL` (named in the message, value absent
  from the output). Real OS signal delivery (terminal Ctrl+C, `kill`) is
  UNVERIFIED: on Windows, Node cannot send a catchable SIGINT to another
  process. Negative control: with five fixes reverted in a throwaway
  copy (DEF-01 guard, Turnstile bypass, Sentry `NODE_ENV`, HMAC fallback,
  limiter storage fail-closed) the run FAILED (bundle suite 13 failed and
  16 cancelled, real-bundle checks 11 failed), each mutation caught.
- **Pending:** a run on Node.js 22 (`.node-version`); not installed locally and
  not installed without authorization. Static generation, Netlify packaging, and
  database-backed paths stay with P4-03 and P5-05.
- **Deferred RR-03B limitations (R3/R4), not implemented:** the preload guard
  covers the Node APIs it hooks (`fetch`, `WebSocket`, and
  `net.Socket#connect`, which `http`, `https`, `tls`, and undici use), but it
  is not OS-level network isolation. **R3:** network APIs it does not hook, such
  as `dgram` (UDP) and `dns` resolution, and sockets opened by native addons,
  bypass it; the in-process self-test proves the hooks are installed, not that
  nothing else can reach the network. **R4:** native or non-Node subprocesses do
  not load or honor a Node preload, and a Node subprocess started with its own
  `NODE_OPTIONS` or `--import` flags may drop it; the guard-install count shows
  which Node processes loaded it, not which processes ran. An OS sandbox or
  firewall boundary is still required for a complete no-network guarantee.
- **Interruption limits:** on Windows, stopping a child terminates that process
  only; build workers it started may outlive it (none did in the verification
  runs), and a workspace they still hold is reported, not deleted.
- **Evidence:** working-tree changes on `fix/sentry-production-initialization` (no commit SHA yet).
- **Security impact:** none on the application; adds regression coverage. **Production impact:** none.

#### P4-12 — Live `auth:verify` and `security:verify`
- **Status:** BLOCKED (part of P4-03; never against production).

#### P4-13 — Continuous integration
- **Status:** TODO (decision OD-17; TD-03, TD-08)
- **Acceptance:** lint, typecheck, and unit and render tests on every push;
  `npm run test:bundle` (offline, no secrets; P4-14) on Node.js 22; the full
  build where a disposable database is available.

## Phase 5 — Release readiness

#### P5-01 — Security review of local commits
- **Status:** IN PROGRESS (SD-13F outcome conditional; F1 and F3 corrected locally)
- **Depends on:** P1-05, P2-06, P4-02 · **Requirements:** REL-01
- **Acceptance:** owner review accepts `10f09b4`, `ce81964`, `be10fb4`, and `4f7f564` for merge.

#### P5-02 — Environment verification
- **Status:** TODO
- **Requirements:** REL-05
- **Acceptance:** the owner confirms in the Netlify UI, without revealing
  values, that `RATE_LIMIT_HMAC_SECRET` (≥ 32), Better Auth, database, R2, and
  origin variables exist for production. Turnstile and Resend are confirmed before P5-09.
  When monitoring is enabled, `NEXT_PUBLIC_SENTRY_*` are available to Functions
  (runtime), not only Builds (OBS-02). The build environment does not set
  `NODE_ENV` (SEC-CAND-01).
- **Production impact:** read only.

#### P5-03 — Legal approvals
- **Status:** BLOCKED (qualified legal review; owner)
- **Depends on:** P3-08 · **Requirements:** REL-03

#### P5-04 — Monitoring accounts
- **Status:** TODO (Roadmap Phase 10)
- **Acceptance:** Sentry and Umami accounts decided and configured; DEF-02 fixed (P2-09, locally); uptime monitoring decided. On an **unpublished** deploy with its own environment label, one controlled server error arrives exactly once and scrubbed, its boundary re-render adds no second event (OBS-01), and a browser-only error arrives once. Decide OD-18.

#### P5-05 — Deployment verification
- **Status:** TODO
- **Depends on:** P4-03, P5-01, P5-02 · **Requirements:** REL-06
- **Acceptance:** an unpublished Netlify deploy of the candidate passes smoke
  tests while Auto Publishing stays LOCKED.

#### P5-06 — Rollback planning
- **Status:** TODO · **Requirements:** REL-07
- **Acceptance:** restore point identified (currently `288fde6`); 04_TRD §8.6 reviewed.

#### P5-07 — Production administrator
- **Status:** BLOCKED: **NOT AUTHORIZED**
- **Requirements:** REL-04
- **Acceptance:** owner authorizes; `admin:bootstrap` with production confirmation; sign-in verified.

#### P5-08 — Owner authorization to publish
- **Status:** BLOCKED: **NOT AUTHORIZED**
- **Depends on:** P5-01, P5-02, P5-05, P5-06 · **Requirements:** REL-08

#### P5-09 — Inquiry activation
- **Status:** BLOCKED
- **Depends on:** P5-03, P5-02 (Turnstile and Resend), P5-08, and a separate owner decision.
- **Production impact:** starts collecting personal data.

#### P5-10 — Refresh stale earlier documents
- **Status:** TODO (outside the files currently authorized)
- **Acceptance:** CONF-01…06 resolved in `ARCHITECTURE.md`, `README.md`,
  `DEVELOPMENT.md`, ADR 0010 status, and `ROADMAP.md`.

## Recommended release sequence

1. P0-04: decide the remaining open decisions (OD-01 resolved 2026-11-03).
2. P5-01: owner review of the local commits.
3. P4-03: authorize and run disposable-Neon integration.
4. P5-02: confirm the Netlify environment, especially `RATE_LIMIT_HMAC_SECRET`.
5. Merge the local chain into `main` (owner instruction), push, and run P5-05
   with Auto Publishing locked.
6. P5-06, then P5-08: publish on explicit owner authorization.
7. P5-07 if an administrator is authorized.
8. Later and separately: P5-03 → P5-09.

## Decision register

| ID | Decision | Raised in | Blocks | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| OD-01 | May EDITORs delete media? **No**: only ADMIN and SUPER_ADMIN may permanently delete media, including unassigned images (matches ADR 0004). | 04_TRD DEF-01 | P1-07 | Owner | **RESOLVED 2026-11-03** |
| OD-02 | May EDITORs retry or recover email and edit customer contact data? | 05_Schema §6.3 | — | Owner | OPEN |
| OD-03 | Password reset and MFA for administrators | 01_PRD | P1-08 | Owner + security | OPEN |
| OD-04 | Align technical names with the brand (package, `appName`, fallback studio name) | 04_TRD TD-05 | — | Owner | OPEN |
| OD-05 | Restrict inquiry status transitions | 02_AppFlow SM-06 | — | Owner | OPEN |
| OD-06 | Add PostgreSQL RLS, or document application-layer authorization as sufficient | 05_Schema §6.1 | — | Owner + security | OPEN |
| OD-07 | Inquiry retention period and automation | 01_PRD NFR-PRIV-02 | P5-09 (recommended) | Owner + legal | OPEN |
| OD-08 | Align local Node major with production; add `engines` | 04_TRD §1.1 | — | Owner | OPEN |
| OD-09 | Approve success-metric targets | 01_PRD §5 | — | Owner | OPEN |
| OD-10 | Accessibility audit method | 01_PRD | P3-05 | Owner | OPEN |
| OD-11 | Purpose of `neon.ts` tooling configuration | 04_TRD TD-07 | — | Owner | OPEN |
| OD-12 | One palette: global tokens or the contact `--mv-*` set | 03_UI_Spec UI-INC-01 | P3-07 | Owner | OPEN |
| OD-13 | Named tokens for display sizes and tracking | 03_UI_Spec UI-INC-02 | P3-07 | Owner | OPEN |
| OD-14 | Accessible confirmation component instead of `window.confirm` | 03_UI_Spec UI-INC-05 | P3-07 | Owner | OPEN |
| OD-15 | Require administrator email verification | 04_TRD SEC-01 | P1-09 | Owner | OPEN |
| OD-16 | Audit sign-ins through the HTTP route | 04_TRD TD-09 | P2-10 | Owner | OPEN |
| OD-17 | CI provider and required checks | 04_TRD TD-03 | P4-13 | Owner | OPEN |
| OD-18 | Log once when production monitoring is disabled by a missing or malformed DSN (OBS-03) | 04_TRD §9.6 | P5-04 | Owner | OPEN |

## Mandatory task-update procedure

After **every verified** completed task:

1. Update the task's **Status** here, and the checklist rows that depend on it.
2. Record the tests run and their results (counts, not "passed").
3. Record the commit SHA, or "uncommitted" with the branch name.
4. Update the dependencies of downstream tasks.
5. Record new blockers, defects (`DEF-*`), and decisions (`OD-*`).
6. Record the production impact and the release state. Never write "deployed"
   for a local or unpublished commit.
7. Update the affected architecture documents (01–05) if a contract, route,
   schema, token, or flow changed, and bump their version and review date.

**Never mark a task DONE without evidence.** A task whose result depends on
unavailable infrastructure stays BLOCKED or UNVERIFIED.

## Known limitations

- Completion dates are commit dates. Live verification dates are given only
  where a run is recorded.
- SD-12 and parts of SD-13F cannot be reconstructed from the repository.
- Netlify-side states are owner-reported.
