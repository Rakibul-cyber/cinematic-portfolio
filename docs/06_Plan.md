# 06 — Dependency-Ordered Implementation Plan

| Field | Value |
| --- | --- |
| Document | `docs/06_Plan.md` |
| Version | 1.1.0 (DEF-01 fix and DEF-04 registration) |
| Last reviewed | 2026-11-03 |
| Reviewed against | commit `2e3419a` plus uncommitted DEF-01 changes on `fix/media-delete-admin-only` |
| Document status | Draft for owner review. Not committed. |

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

## Current release position (2026-11-03)

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
| DEF-01 media-deletion fix | LOCAL ONLY, uncommitted (`fix/media-delete-admin-only`) |
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
- **Status:** IN PROGRESS. Written and self-checked; awaiting owner review and commit authorization.
- **Depends on:** P0-01
- **Files:** `docs/01_PRD.md` … `docs/06_Plan.md`, `CLAUDE.md`, `.cursorrules`
- **Acceptance:** all eight files exist, cross-links resolve, IDs are
  consistent, the facts match the repository, and the owner approves.
- **Tests:** cross-document consistency checks (link, ID, route, version,
  schema, and secret scans).
- **Evidence:** consistency report delivered with the documents.
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
- **Status:** DONE (offline verification) · **Completed:** 2026-11-03 · **Release:** LOCAL ONLY. **Uncommitted** on branch `fix/media-delete-admin-only` (from `2e3419a`); not deployed.
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
  typecheck, lint, and `git diff --check` clean.
- **Pending:** proof over a real HTTP Server Action call with a real session
  and database is part of P4-03 (BLOCKED, postponed).
- **Evidence:** working-tree diff on `fix/media-delete-admin-only` (no commit SHA yet).
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
- **Status:** TODO
- **Files:** `src/lib/monitoring/options.ts`, `src/sentry.server.config.ts`
- **Acceptance:** server reporting does not depend on the runtime `NODE_ENV` in
  a production build; a production-build test proves it.
- **Security impact:** low (observability). **Production impact:** monitoring behaviour.

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

## Phase 4 — Edge cases and testing

#### P4-01 — Unit and render suites
- **Status:** DONE · **Last verified:** 2026-11-03 at `4f7f564`
- **Evidence:** `npm test`: 472 passed, 0 failed, 2 skipped; render 264 passed; typecheck and lint clean.

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
  limits, limit separation, log hygiene, full build with bundle checks.
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
  Turnstile bypass in server bundles). **Full build BLOCKED**: static generation needs a database (P4-03).

#### P4-11 — Security regression suites
- **Status:** DONE (`*production-build.test.ts`, `security.test.ts`).

#### P4-12 — Live `auth:verify` and `security:verify`
- **Status:** BLOCKED (part of P4-03; never against production).

#### P4-13 — Continuous integration
- **Status:** TODO (decision OD-17; TD-03, TD-08)
- **Acceptance:** lint, typecheck, and unit and render tests on every push; the
  full build where a disposable database is available.

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
- **Production impact:** read only.

#### P5-03 — Legal approvals
- **Status:** BLOCKED (qualified legal review; owner)
- **Depends on:** P3-08 · **Requirements:** REL-03

#### P5-04 — Monitoring accounts
- **Status:** TODO (Roadmap Phase 10)
- **Acceptance:** Sentry and Umami accounts decided and configured; DEF-02 fixed (P2-09); uptime monitoring decided.

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
