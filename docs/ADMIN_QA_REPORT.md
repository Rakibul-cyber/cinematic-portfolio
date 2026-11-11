# Admin QA Report: Munir Visuals

| Field | Value |
| --- | --- |
| Date | 2026-11-11 |
| Site tested | https://munirvisuals.com (production) |
| Code reviewed | `main@d0f05a8`, working tree clean |
| Deployed commit | UNVERIFIED (not visible from outside; owner to confirm in Netlify) |
| Tester | Claude Code, from the repository and from outside the site, with no admin session |

Statuses used: **PASS** (actually tested and working), **FAIL** (tested and
broken), **BLOCKED** (cannot test because of a dependency), **NOT RUN** (not
executed).

## 1. Executive summary

- **Everything that can be tested without signing in passes.** Signed-out
  access control, the upload API, sign-up closure, security headers, public
  pages, and R2 image delivery were tested live, by HTTP and in a real browser
  at desktop and phone sizes. No test failed.
- **Every signed-in feature is BLOCKED.** No admin credentials were available
  to the tester, and they must not be pasted into chat. Creating, editing,
  publishing, deleting, uploading, reordering, and every other admin button
  were therefore not exercised in a browser. Section 9 lists them and section
  10 gives a way to run them without sharing a password.
- **The automated suites pass**: 886 tests (884 passed, 2 skipped by design),
  plus typecheck, lint, and the production-bundle check. They cover the admin
  logic offline, with a fake database. They are evidence about the code, not
  about the live site.
- **No functional bug was confirmed.** Four things on the live site need the
  owner's attention (section 7): a test project is public, the site still
  shows the placeholder name "Portfolio", temporary diagnostic code is still
  in the codebase, and a Netlify badge covers content on phones.
- Nothing in production was created, changed, or deleted by this audit.
- **Update, signed-in run (sections 11 and 13):** the owner ran the read-only
  suite: 89 checks, 78 PASS, 2 FAIL, 9 NOT RUN. `d0f05a8` is deployed. One
  bug is confirmed and fixed locally (F-6, exports run without a click). The
  other failure could not be reproduced and its cause is unconfirmed.
- **Update, second signed-in run (section 14):** after the fix was deployed,
  89 checks, 79 PASS, 1 FAIL, 9 NOT RUN. F-6 is fixed on the live site. The
  one failure, a React hydration error on a single load of Categories, could
  not be reproduced; no application bug is confirmed.

## 2. Inventory of admin sections

Taken from the code. Minimum role in brackets: EDITOR is any signed-in user,
ADMIN is ADMIN or SUPER_ADMIN.

| Section | Route | What it offers | Server guard |
| --- | --- | --- | --- |
| Sign in | `/admin/login` | Email and password form (`signInAction`); generic error; rate limit | Public |
| Sign out | every admin page | Sign out button (`signOutAction`) | Session |
| Dashboard | `/admin` | 8 counters (projects, published, drafts, media, services, testimonials, new and open inquiries); 4 shortcuts (New project, Media, Services, Testimonials) | `requireUser` |
| Navigation | every admin page | 10 links; Settings hidden from EDITOR; menu button below `md` | — |
| Projects list | `/admin/projects` | New project link, Edit links, Delete (ADMIN, confirm dialog) | `requireUser`; delete `requireAdmin` |
| New / Edit project | `/admin/projects/new`, `/admin/projects/[id]` | Title (required), short description, video link (YouTube, Vimeo, Google Drive), media picker (upload, add from library, Make cover, Up, Down, Remove), Publish checkbox, Advanced details (slug, full description, client, location, date, order, featured, SEO), Save | `requireUser`; stale-save check |
| Categories | `/admin/categories` | Create and edit form, Edit links, Delete (ADMIN; refused while projects use it) | `requireUser`; delete `requireAdmin` |
| Media library | `/admin/media` | Upload form (file, alt text), per-image alt text and caption form, Delete image and all variants (ADMIN; refused while a project uses it) | `requireUser`; delete `requireAdmin` |
| Upload API | `POST /api/media` | Used by the Media library and the project media picker | `getCurrentUser`, else 401 |
| Services | `/admin/services` | Create and edit form, Edit links, Delete (ADMIN) | `requireUser`; delete `requireAdmin` |
| Testimonials | `/admin/testimonials` | Create and edit form, Edit links, Delete (ADMIN) | `requireUser`; delete `requireAdmin` |
| Pages | `/admin/pages` | Edit form per content page | `requireUser` |
| Settings | `/admin/settings` | Site settings form (studio name, contact, SEO, showreel); social links create, edit, delete | `requireAdmin` (page and actions) |
| Inquiries list | `/admin/inquiries` | Search, status filter, pagination (25), cards below `lg` and a table above, Export CSV (ADMIN) | `requireUser`; export `requireAdmin` |
| Inquiry detail | `/admin/inquiries/[id]` | Update status, email retry and recovery buttons, link to customer, status history | `requireUser` |
| Customers list | `/admin/customers` | Search, pagination (25) | `requireUser` |
| Customer detail | `/admin/customers/[id]` | Edit details, add note, inquiry history; SUPER_ADMIN only: Export customer data, Anonymize (typed confirmation) | `requireUser`; privacy `requireSuperAdmin` |
| Error views | `/admin/*` | Admin 404, 403, and error page with Try again | — |

**Not implemented** (so nothing to test): user management, password change or
reset, an audit-log viewer, and a security settings page. Administrators are
created only by the local `npm run admin:bootstrap` script. Audit rows are
written but have no screen.

## 3. Test results by feature

### 3.1 Live, signed out (HTTP)

| Test | Status | Evidence |
| --- | --- | --- |
| 14 admin routes redirect to login when signed out | PASS | Each returned 307 to `/admin/login?next=<path>` with `Cache-Control: private, no-store` (all sections, both export routes, an unknown admin path) |
| Login page is reachable and never cached | PASS | 200, `private, no-store` |
| A forged session cookie does not get in | PASS | With a cookie that is present but invalid, `/admin`, `/admin/settings`, and both exports returned 307 to login. The redirect came from the server check, not the middleware |
| Upload API refuses a signed-out upload | PASS | `POST /api/media` returned 401 `Authentication required.`, with and without the forged cookie |
| Upload API accepts POST only | PASS | `GET /api/media` returned 405 |
| Public sign-up is closed | PASS | `POST /api/auth/sign-up/email` returned 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` (sent with an invalid password, so no account could be created either way) |
| Signed-out session lookup reveals nothing | PASS | `/api/auth/get-session` returned `null` |
| Security headers on the login page | PASS | CSP (`frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`), HSTS one year, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy |
| Admin and API are excluded from search engines | PASS | `robots.txt`: `Disallow: /admin`, `Disallow: /api/` |
| Public pages respond | PASS | `/`, `/work`, `/services`, `/about`, `/contact`, `/robots.txt`, `/sitemap.xml` returned 200; an unknown project returned 404 |
| Legal pages stay hidden until approved | PASS | `/privacy` and `/impressum` returned 404, as designed while approvals are pending |
| R2 image delivery | PASS | Thumbnail, 640 px, and master variants returned 200 `image/webp` with a one-year immutable cache header |
| R2 bucket is not listable | PASS | Bucket root returned 404; an unknown key returned 404 |
| Published project appears on the public site | PASS | `/work/new` returned 200 with its image and video poster; it is listed on `/work` and in the sitemap |

### 3.2 Automated suites (offline, at `main@d0f05a8`)

| Check | Status | Evidence |
| --- | --- | --- |
| `npm test`, unit suite | PASS | 594 tests: 592 passed, 0 failed, 2 skipped (the two real-bundle checks, which run in `test:bundle`) |
| `npm test`, render suite | PASS | 292 tests: 292 passed, 0 failed |
| `npm run typecheck` | PASS | Exit 0 |
| `npm run lint` | PASS | Exit 0 |
| `npm run test:bundle` | PASS | 56 of 56 and 32 of 32; 0 network attempts. Ran on Node 24.13.0; the Node 22 run is still pending |
| Existing browser tests | NOT RUN | The repository contains none |

What these suites cover for the admin, with a fake database: role guards on
every action, project save and stale-save refusal, slug conflicts, media
attach order and cover, upload preparation and error messages, delete
authorization, form error handling and focus, sign-in rate limiting, CRM
actions, CSV export, and anonymization.

## 4. Buttons and interactions tested

| Interaction | Status | Evidence |
| --- | --- | --- |
| Sign in button with empty fields | PASS | Browser, both sizes: message "Unable to sign in with those credentials.", focus returns to the email field, field marked invalid, no session cookie set. The server rejects empty input before any database write |
| Sign in with wrong credentials | NOT RUN | It writes an audit row and rate-limit counters to production and can lock out the real administrator. Covered offline by `login-rate-limit.test.ts` and `authorization.test.ts` |
| Sign in with valid credentials, sign out | BLOCKED | No credentials |
| Every button inside the admin (Save, Delete, Edit, Publish, Upload, Add, Make cover, Up, Down, Remove, Filter, Search, pagination, Export, Update status, Retry email, Add note, Anonymize, menu button, Try again) | BLOCKED | No credentials |

## 5. Browser and mobile results

Real browser: Playwright driving installed Chrome, headless, against
production. Desktop 1440 × 900 and phone 390 × 844 (touch). 34 checks ran, 17
per size; all passed. No credentials were entered.

| Test | Desktop | Mobile | Evidence |
| --- | --- | --- | --- |
| Login page loads | PASS | PASS | 200, title "Sign in" |
| Email and password fields are labelled | PASS | PASS | Labels "Email address" and "Password"; correct autocomplete; 48 px tall |
| Sign in button visible | PASS | PASS | 48 px tall |
| No console errors, no failed requests | PASS | PASS | 0 and 0 |
| No horizontal scrolling | PASS | PASS | 0 px overflow |
| No sign-up link offered | PASS | PASS | 0 links |
| Empty sign-in shows the error | PASS | PASS | See section 4 |
| Signed-out `/admin`, `/admin/projects/new`, `/admin/media`, `/admin/settings` land on login | PASS | PASS | Final URL `/admin/login?next=<path>` |
| Public `/`, `/work`, `/work/new`, `/services`, `/contact` render cleanly | PASS | PASS | 200; 0 broken images; 0 console errors; 0 failed requests; 0 px overflow |
| Admin pages after sign-in, at either size | BLOCKED | BLOCKED | No credentials |

One correction to my own test: the first run expected the browser to stop an
empty sign-in. The form deliberately validates on the server, so the
expectation was wrong and the check was rewritten. The site behaved correctly.

## 6. Database and R2 integration

| Test | Status | Evidence |
| --- | --- | --- |
| Public pages read from the database | PASS | A project created in the admin (`/work/new`) is rendered publicly and listed in the sitemap |
| An uploaded image is stored in R2 and served | PASS | Its thumbnail, 640 px, and master files are public with correct type and cache headers |
| Image origin matches the security policy | PASS | The image host equals the `img-src` origin in the CSP |
| Larger variants exist only when the source is large enough | PASS | 1280 and 1920 px files are absent for this small image, and no page requests them |
| Database is the intended production branch | NOT RUN | Needs a production query or the Netlify variable; not authorized in this audit |
| Records persist after refresh in the admin | BLOCKED | No credentials |
| Media to project associations save correctly | BLOCKED | No credentials. The public project page shows its image, which is indirect evidence that one association saved |
| Deleting an image removes its R2 files | NOT RUN | Destructive; needs approval and credentials |

## 7. Confirmed findings

One functional defect is confirmed, F-6, found by the signed-in run (section
13). The others were observed on the live site or in the code.

| ID | Severity | Finding | How to see it |
| --- | --- | --- | --- |
| F-1 | Medium | A test project titled "new", with a test screenshot as its image, is published. It is on `/work`, the home page, and in the sitemap | Open https://munirvisuals.com/work/new |
| F-2 | Medium | The site shows the placeholder name "Portfolio" in the header, footer, page titles, and on the login page. The code uses this fallback when Site settings has no studio name | Open the home page; the tab title is "Portfolio" |
| F-3 | Low | The temporary project-save diagnostic (`src/server/diagnostics/`, `src/lib/diagnostics/`, and its call in `saveProject`) is still on `main`. The plan says it must be removed after diagnosis | `git log`: `5ac4412`, `020905a`, `4648177` |
| F-4 | Low | A "Powered by Netlify" badge sits over the bottom-right of every page and covers footer content on a phone. It is added by Netlify, not by the repository | Open any page at phone width |
| F-5 | Info | The published project's image has no alt text | Media library, alt text field |
| F-6 | Medium | Viewing the Inquiries page runs the CSV export and writes a `crm.exported` audit entry without a click, on every view, search, and filter. The customer page does the same for "Export customer data". **Fixed in the commit that carries this report; live only once that commit is deployed** | Section 13 |

## 8. Security concerns

Verified live: signed-out access control, forged-cookie rejection, closed
sign-up, a non-listable bucket, and the security headers (section 3.1).

From code review, not verified live:

| ID | Severity | Concern |
| --- | --- | --- |
| S-1 | Medium | There is no password change or reset, and the bootstrap script refuses an email that already exists. A forgotten password can only be fixed by hand in the database |
| S-2 | Low | The CSP allows inline scripts (`script-src 'unsafe-inline'`). Evaluated code is blocked: the browser test hit that block |
| S-3 | Low | HSTS has no `includeSubDomains` |
| S-4 | Low | Authorization exists only in server code; the database has no row-level security. A new page or action that forgets its guard would be open. The current guards are covered by `action-guards.test.ts` |
| S-5 | Info | Sessions last 8 hours and are checked against the database on every request, so sign-out and role changes apply at once |

## 9. Untested or blocked functionality

All BLOCKED for the same reason: no admin session.

- **Authentication:** valid sign-in, sign-out, session persistence across
  refresh, expiry after 8 hours, return to the requested page after sign-in.
- **Roles:** what an EDITOR, ADMIN, and SUPER_ADMIN can see and do. Needs one
  account per role.
- **Dashboard:** counters match the data; the four shortcuts.
- **Projects:** create, edit, save, publish, unpublish, delete; required and
  optional fields; a project without a category; YouTube, Vimeo, and Google
  Drive links; cover choice and gallery order; stale-save refusal; reopening
  to confirm persistence.
- **Media library:** JPEG, PNG, and WebP upload; several files at once;
  thumbnails; browser-side resizing; wrong type and oversized files; alt text
  and caption; delete, and the refusal while a project uses the image.
- **Categories, Services, Testimonials, Pages, Settings, social links:**
  create, edit, delete, and the effect on the public site.
- **Inquiries and Customers:** search, filter, pagination, status change,
  email retry, notes, CSV export, customer export, anonymize. These also need
  inquiry data, and inquiry intake is closed.
- **Mobile admin:** the menu button, forms, and tables at phone width.
- **Server logs:** Netlify function logs are not accessible from here.

Also NOT RUN: wrong-password sign-in and rate limiting on production
(section 4), and whether production is running `d0f05a8`, which contains the
project media picker fix.

## 10. Recommended next steps, by priority

1. **Unpublish or delete the test project** (F-1). Owner, in the admin.
2. **Fill in Site settings** so the real studio name replaces "Portfolio"
   (F-2). Owner, in the admin.
3. **Run the signed-in test pass.** Two options:
   - A manual checklist built from section 9, done by the owner in a browser.
   - An automated Playwright pass run from the owner's own terminal, with the
     email and password typed at a hidden prompt and never saved or shared.
     It would create clearly named disposable records ("QA test …") and leave
     them for the owner to delete. This writes to production, so it needs
     explicit approval first.
4. **Remove the temporary diagnostic** (F-3): revert the three commits in a
   reviewed change.
5. **Decide on a password-recovery path** (S-1): at least a documented manual
   procedure, or a reset command beside the bootstrap script.
6. **Remove the Netlify badge** (F-4) in the Netlify dashboard, if the plan
   allows it.
7. **Confirm the deployed commit** in Netlify, so the media picker fix is
   known to be live.

No fix was applied during this audit.

## 11. Signed-in automated pass (run by the owner 2026-11-11)

The owner chose the automated option and ran the read-only suite in
[`qa/admin-e2e/`](../qa/admin-e2e/README.md) as SUPER_ADMIN: **89 checks, 78
PASS, 2 FAIL, 9 NOT RUN, 0 BLOCKED**. The statuses below are from that run;
section 13 covers the two failures. Rows in sections 4 to 9 that say BLOCKED
describe the first, signed-out audit.

How it stays read-only: every request that could change data is blocked in the
browser before it is sent, except the sign-in and the sign-out. Export links
are answered locally and never reach the site. The run leaves two audit
entries (signed in, signed out) and revokes its own session.

What was checked without signing in: the script's syntax, lint, the four
sample video links against the site's own parser, and that it refuses to start
without an interactive terminal. The selectors come from reading the source,
so a failure on the first run may be a mistake in a test, not in the site.
Each failure will be triaged before it is recorded as a bug.

| Area | Checks in the suite | Status |
| --- | --- | --- |
| Authentication | Sign-in reaches the dashboard; cookie is HttpOnly, Secure, SameSite, at most 8 hours; session survives refresh; login page redirects a signed-in user; an outside return address is ignored; Sign out; admin closed after sign-out; old session cookie rejected | PASS (8 of 8) |
| Navigation, desktop | Links match the role; each of the 10 sections opens from the menu with the right heading, current-page marker, no console errors, no failed requests, no sideways scroll | PASS for 9 sections; Inquiries FAIL once, cause unconfirmed (section 13) |
| Navigation, mobile | Menu button opens and closes; the same section checks at 390 px | PASS (12 of 12) |
| Dashboard | Eight numeric counters; Drafts = Projects − Published; four shortcuts; Projects, Media, Services, Testimonials counters match their lists | PASS (7 of 7) |
| Deployment | The Project media section has the upload control, which exists only from `d0f05a8` | PASS: `d0f05a8` is live |
| Projects | List and New project link; Delete offered by role (not pressed); everyday fields; Advanced details; YouTube, Vimeo, Google Drive recognised and an ordinary page refused; up to 3 existing projects open with saved values that survive a refresh; public page matches published or draft state; unknown project gives the admin 404 | PASS (13 of 13; one existing project) |
| Project media | Library thumbnails load; Add, Make cover, Up, Down, Remove change the form order (never saved) | PASS (4 of 4) |
| Media library | Upload form and accepted types; every thumbnail loads; images served from R2 as WebP with a long cache; alt text and caption forms; Delete offered by role (not pressed) | PASS (5 of 5) |
| Categories, Services, Testimonials | Create form fields; Edit loads a record and survives refresh (not saved); Delete offered by role (not pressed) | Create forms PASS; Edit and Delete NOT RUN (no records exist) |
| Pages, Settings | Forms present (not submitted); whether the studio name is filled in; an editor is refused Settings | PASS; editor refusal NOT RUN (the account is SUPER_ADMIN) |
| Inquiries, Customers | Lists render; empty search; all 8 status filters; pagination; Export offered by role (not followed); detail pages; privacy tools only for SUPER_ADMIN | Lists, search, 8 filters, export link PASS; pagination and detail pages NOT RUN (no inquiries or customers exist) |
| Error pages | Unknown admin address gives the admin 404 | PASS |
| Mobile layout | New project, Media library, and dashboard fit 390 px; media controls at least 40 px tall | PASS (4 of 4) |
| Safety and audit | No data-changing request was attempted; export links are not fetched without a click | Safety PASS; Audit FAIL, confirmed bug F-6 (section 13) |

One thing the suite checks because the code suggests a risk: "Export CSV" and
"Export customer data" are ordinary links, and the framework may fetch a link's
target in advance when it appears on screen. If it does, each view of those
pages would run an export and write an audit entry. The run **confirmed** it;
see F-6 in section 13.

Roles: the suite adapts to the role of the account used. Testing all three
roles needs one account per role, and creating accounts is outside this audit.

## 12. Proposed write tests (awaiting separate approval; none prepared or run)

Every record would be named `QA TEST <date-time> …` and the suite would touch
only records it created in that run. Each write also adds audit entries.

| ID | Test | What it creates or changes | Left behind |
| --- | --- | --- | --- |
| W1 | Upload one small generated JPEG, PNG, and WebP in the Media library; check thumbnails, R2 files, alt text and caption after refresh | 3 media records, about 12 R2 files | 3 images named `qa-test-…` |
| W2 | Upload a text file renamed `.jpg`, and a file over the size limit | Nothing; both must be refused | Nothing |
| W3 | Create a draft project with a short description and a YouTube link; upload 2 images in the project form and add 1 from the library; save; reopen | 1 project, 2 more media records | 1 draft project |
| W4 | On that project: Make cover, reorder, remove one image, save, reopen; then switch the link to Vimeo and to Google Drive, saving each time | Edits to the QA project only | — |
| W5 | Publish the QA project, check its public page and cover, then unpublish and check it is gone | The QA project is public for about a minute, including in the sitemap | Draft again |
| W6 | Open the QA project in two tabs, save in one, then in the other | The second save must be refused | — |
| W7 | Create a second project with the same slug | Must be refused on the slug field | Nothing |
| W8 | Create, edit, and deactivate one category, one service, and one testimonial, each created inactive so it never appears publicly | 3 records | 3 inactive records |
| W9 | Optional: delete only the records created by W1 to W8, checking that an image still used by the QA project is refused first and that deleted images disappear from R2 | Removes the QA records | Nothing |
| W10 | Optional: one sign-in attempt with a wrong password for an address that is not an account | 1 audit entry and one count against the per-computer limit of 20, not against the owner's account | — |

Not proposed, because they touch real records or settings: editing Pages or
Site settings, social links, any change to existing customers or inquiries,
anonymization, exports, and anything involving user roles.

## 13. The two failures from the signed-in run

The live site was not touched for this investigation. Both were examined in a
throwaway copy of the same setup (Next.js 15.5.28, the real navigation link
component, slow pages, no database) driven by the same browser steps.

### F-6: exports run without a click (confirmed, fixed locally)

- **What the run saw:** `/admin/inquiries/export` was requested 15 times and
  the suite never clicked the link. The suite answered those requests itself,
  so the run wrote no audit entry.
- **Cause, reproduced:** "Export CSV" and "Export customer data" were
  `next/link` links. Next.js fetches a visible link's target in advance. For a
  page that is harmless; an export address has no page, so the advance fetch
  reaches the export code as an ordinary signed-in request. In the copy, one
  view of the page produced one export request carrying the prefetch headers,
  with no click.
- **Does it do real work?** Yes. The export code does not look at those
  headers: it checks the role, reads every inquiry, writes a `crm.exported`
  audit entry, and returns the file. So in normal use each view, search, or
  filter of Inquiries by an ADMIN or SUPER_ADMIN has been adding a false
  "exported" entry, and each view of a customer by a SUPER_ADMIN a false
  `privacy.customer_exported` entry. Nothing is shown or downloaded, and no
  data leaves the signed-in browser, but the audit log overstates exports.
- **Fix:** both links are now plain download links (`<a download>`), which
  the browser requests only on a click. In the copy: zero requests on view,
  exactly one on click. Two page files, one line each.
- **Regression test:** `src/app/(admin)/admin/export-links.test.ts` fails if
  any `next/link` in the admin points at a download address. It fails on the
  old code (3 of 5) and passes on the fix (5 of 5).
- **Status:** fixed in the commit that carries this report. The live site has
  the bug until that commit is deployed. False entries already in the audit log
  were not counted or removed (no database access in this task).

### Desktop menu: Inquiries showed the Dashboard heading (not reproduced)

- **What the run saw:** once, on desktop, after clicking Inquiries the address
  was `/admin/inquiries` and the heading read "Dashboard". The same step
  passed on mobile, the Inquiries page passed its own five desktop checks
  later in the run, and the other nine sections passed.
- **What is established:** the test did not wait. After a menu click the page
  changes without loading a new document, and the wait the test relied on
  returns immediately in that case (measured: 0 to 1 ms). It read the heading
  the instant the address matched.
- **What is not established:** why the heading and address disagreed at that
  instant. In the copy they always changed together, across several timing
  combinations, including a still-pending Dashboard request and the suite's
  own export blocking. So neither "test timing" nor "site bug" is proven.
- **No site change was made**, because no cause was confirmed.
- **Test change:** the check now waits up to 15 seconds for the heading, and
  reports how long it took and the final address. Next run: an immediate PASS
  means it was a one-off; a PASS "after N ms" means the site briefly shows the
  new address over the old page; a FAIL after 15 seconds means a real bug,
  with the evidence to find it.

### Checks after the changes

| Check | Result |
| --- | --- |
| `npm test` | 891 tests: 889 passed, 0 failed, 2 skipped by design (599 unit, 292 render) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `git diff --check` | PASS |
| `npm run test:bundle` | NOT RUN after this change |
| Signed-in suite rerun | Run by the owner after `c971e05` was deployed; see section 14 |

## 14. Second signed-in run (after `c971e05` was deployed)

Run by the owner as SUPER_ADMIN: **89 checks, 79 PASS, 1 FAIL, 9 NOT RUN, 0
BLOCKED.**

- **F-6 is fixed on the live site:** zero automatic export requests.
- **Desktop Inquiries navigation passed.** The first run's failure did not
  recur; its cause remains unconfirmed.
- The 9 NOT RUN checks are the same as before: they need categories,
  services, testimonials, inquiries, or customers, and none exist.

### The one failure: React error 418 on the Categories page (not reproduced)

Error 418 means the page the server sent did not match what React built in
the browser when it started up (a hydration mismatch, here of an element, not
of text). React recovers by rebuilding the page in the browser, which is why
every other part of the same check found the form and its fields.

**Root cause: not confirmed.** What was checked:

| Question | Finding | How |
| --- | --- | --- |
| Does the Categories page mismatch on every load? | No. It loaded cleanly in 8 of its 9 loads across the three signed-in runs, including twice in this same run (desktop and mobile menu) | Run results |
| Browser-only values, dates, random values, or `typeof window` branches in the page or its components? | None. The page, `AdminShell`, `AdminMenu`, `AdminNavLink`, `AdminForm`, `Notice`, and `DeleteButton` render the same output on the server and in the browser. The only date formatting in admin components is in the email-delivery rows, which this page does not use | Code review |
| Conditional rendering that differs between server and browser? | None. `current`, `rows`, and `canDelete` come from the server and reach the browser unchanged | Code review |
| Invalid HTML nesting? | None found: no form inside a form, no block element inside a paragraph or inline element. Services and Testimonials use the same structure and passed | Code review |
| Is Netlify's badge the cause? Netlify adds a script to every page that inserts an `<iframe>` into the body at an unpredictable moment | No. In a copy of the setup, an iframe inserted before React starts, at the end or the start of the body, produced 0 errors in 10 loads | Real Chrome, local copy |
| Does the live site show the error on pages that need no sign-in? | No. 0 console errors in 120 loads (login, home, work, contact; 30 each) | Real Chrome, live site, read-only |
| Reproducible in a real browser? | No, by any means available without the owner's session | — |

**Where it comes from: undetermined.** The evidence is against a fault that
is always present in the Categories page. It does not separate the remaining
possibilities: a one-off in delivery (for example a response cut short), or a
rare timing condition in the application that these checks did not trigger.
One failure in roughly 200 signed-in page loads is the whole sample.

**No application change was made**, because no application bug was confirmed.

**Test change (uncommitted):** when a create-form check sees a console error,
the suite now loads that page three more times and reports how many of those
loads show it. The check still fails, but the evidence says "0 of 3" (a
one-off) or "3 of 3" (a real, repeatable fault).

Checks on the unchanged application at `c971e05`: `npm test` 891 tests
(889 passed, 0 failed, 2 skipped by design); typecheck, lint PASS;
`npm run test:bundle` PASSED (56 of 56, 32 of 32; Node.js 22 verification
pending).

## 15. Admin simplified (MH-15, 2026-11-11): what this changes in the report

The owner approved removing Categories and Testimonials and simplifying the
admin. It is implemented in the working tree: **not committed, not deployed,
so the live site is unchanged and the results in sections 11 to 14 still
describe it.**

**Removed from the application:** the Categories and Testimonials admin
pages, their save and delete actions and validation, the public category
filter and labels, and the public testimonial sections. The database tables
and existing rows are untouched.

**What remains:** Dashboard, Projects, Media, Inquiries, Customers, Settings as
the main menu; Services and Pages in a smaller "Website content" group below
them; every project field, image upload, video link, and publishing.

**Effect on earlier results**

| Earlier item | Now |
| --- | --- |
| Categories and Testimonials rows in sections 2, 3, 9, 11, 12 | Retired once MH-15 is deployed; the features no longer exist |
| React error 418 on one load of Categories (section 14) | Closed as not reproducible; the page is removed, so it cannot recur there. Cause was never confirmed |
| Write tests W7 and W8 (inactive category, testimonial) | Withdrawn. W1 to W6, W9, W10 still stand, still awaiting approval |
| "Dashboard shows eight counters", "four shortcuts" | Replaced by six counters and three quick actions |

**Checks run on the change**

| Check | Result |
| --- | --- |
| `npm test` | 893 tests: 891 passed, 0 failed, 2 skipped by design (604 unit, 289 render) |
| `npm run typecheck`, `npm run lint` | PASS |
| `npm run test:bundle` | `npm run test:bundle` PASSED (56 of 56, 32 of 32; Node.js 22 verification pending) |
| Leftover references in application code | None: a test now fails if application code reads the category or testimonial tables, links to the removed addresses, or mentions either feature |
| Navigation and dashboard in real Chrome, 1440 px and 390 px, SUPER_ADMIN and EDITOR | PASS on a local copy of the real components with stub data: six links (five for an editor), then Website content: Services, Pages; 40 px link height; no sideways scroll; the phone menu opens and closes after navigation |
| Signed-in checks on the live site | NOT RUN: needs deployment, then the owner's run |
| Project create, edit, save, publish; image upload | NOT RUN on the live site: write tests are not approved. Covered offline only |
| Database verification scripts | NOT RUN: edited to match, but they need a database |

**Read-only QA suite:** updated to the simplified admin. After deployment it
expects the six links and the Website content group, six counters, three
quick actions, the renamed "More options (optional)" section, and a 404 on
`/admin/categories` and `/admin/testimonials`. Run against the live site
before deployment it will fail those checks, correctly.

## Summary table

| Test | Status | Evidence | Severity |
| --- | --- | --- | --- |
| Signed-out admin routes redirect to login (14 routes) | PASS | 307 to login, no-store | — |
| Forged session cookie rejected | PASS | 307 to login from the server check | — |
| Upload API requires a session | PASS | 401 | — |
| Public sign-up closed | PASS | 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` | — |
| Security headers present | PASS | CSP, HSTS, nosniff, Referrer-Policy | — |
| Login page, desktop and mobile | PASS | 34 browser checks, 0 failed | — |
| Empty sign-in handled | PASS | Generic message, focus restored, no cookie | — |
| Public pages render, desktop and mobile | PASS | 0 console errors, 0 broken images | — |
| R2 image delivery | PASS | 200 `image/webp`, immutable cache | — |
| R2 bucket not listable | PASS | 404 | — |
| Unit and render suites | PASS | 886 tests: 884 passed, 2 skipped | — |
| Typecheck, lint, bundle check | PASS | Exit 0; 56 of 56 and 32 of 32 | — |
| Test project public | — (finding F-1) | `/work/new` | Medium |
| Placeholder site name | — (finding F-2) | Tab title "Portfolio" | Medium |
| No password reset | — (concern S-1) | Code review | Medium |
| Temporary diagnostic still present | — (finding F-3) | Three commits on `main` | Low |
| Netlify badge covers content on mobile | — (finding F-4) | Phone-width screenshot | Low |
| Wrong-password sign-in, rate limit (live) | NOT RUN | Writes to production; may lock out the admin | — |
| Production database identity | NOT RUN | Not authorized | — |
| Image deletion removes R2 files | NOT RUN | Destructive | — |
| Valid sign-in, sign-out, session expiry | BLOCKED | No credentials | — |
| Role-based access for EDITOR, ADMIN, SUPER_ADMIN | BLOCKED | No credentials | — |
| Dashboard counters and shortcuts | BLOCKED | No credentials | — |
| Projects: create, edit, publish, delete, video, media | BLOCKED | No credentials | — |
| Media library: upload, metadata, delete | BLOCKED | No credentials | — |
| Categories, Services, Testimonials, Pages, Settings | BLOCKED | No credentials | — |
| Inquiries and Customers | BLOCKED | No credentials; no inquiry data | — |
| Admin pages at phone width | BLOCKED | No credentials | — |
| Signed-in read-only suite (section 11) | 78 PASS, 2 FAIL, 9 NOT RUN | Run by the owner as SUPER_ADMIN; the 9 need records that do not exist yet | F-6 |
| Exports run only on a click | PASS on the live site after `c971e05` | Zero automatic export requests in the second run | F-6, fixed |
| Desktop menu: Inquiries opens | PASS in the second run | Failed once in the first run; never reproduced; cause unconfirmed | — |
| Categories page loads without console errors | FAIL once in the second run | React error 418 on one load; not reproduced; cause unconfirmed (section 14). The page is removed by MH-15 | — |
| Admin simplified, Categories and Testimonials removed (MH-15) | Offline checks PASS; live NOT RUN | Implemented locally, not committed or deployed (section 15) | — |
| Commit `d0f05a8` deployed | PASS | The upload control it added is in the live Project media section | — |
| Write tests W1 to W10 (section 12) | NOT RUN | Awaiting approval | — |
