# ADR 0009: SEO, observability, and production deployment

## Status

Accepted for Phase 9.

## Decision

Every SEO decision is made by a pure builder under `src/lib/seo/` and applied by
a thin server wrapper, so canonical normalization, crawl policy, sitemap
contents, metadata precedence, and the JSON-LD graph are assertable offline with
no database, network, or running application. `npm run seo:verify` exercises
them and additionally reads the page sources to confirm every public route
declares metadata and a canonical path. What only Next.js can demonstrate —
that the tags it is handed reach the HTML — stays with `npm run public:verify`.

`NEXT_PUBLIC_SITE_URL` is the deployment origin, with `BETTER_AUTH_URL` as a
fallback because it is already required to be this application's absolute
origin. Without a usable origin nothing guesses a hostname: the sitemap is
empty, `robots.txt` omits its sitemap reference, share images are omitted, and
canonicals stay relative. Canonical paths drop query strings and fragments and
carry no trailing slash, so `/work?category=film` is a view of `/work` rather
than a competing document. `robots.txt` allows the public site and disallows
`/admin` and `/api/`; it emits no `host` directive. It is crawl guidance, not
access control — `/admin` remains protected by server-side authorization.

The sitemap advertises the five public routes plus every published project,
dated from the project's own last change, with static routes dated from the
newest published work. Its query is cached and tagged like every other public
read, so publishing refreshes it on the next request rather than after the
one-hour safety net. Metadata keeps the Phase 5 precedence chain unchanged and
adds absolute canonical, Open Graph, Twitter card, and explicit robots
directives from one document builder. A page with no image of its own falls
back to `/opengraph-image`, a typographic card generated from the CMS studio
name and tagline; compositing a photograph there would elect one project to
represent the studio and tie a build artifact to a deletable media object. A
card with no image degrades to `summary` rather than promising a large image.

Structured data is one `@graph` per page with nodes linked by stable `@id`.
Organization (typed `Organization` + `ProfessionalService`) and WebSite are
emitted from the public layout; the admin area publishes none. Project pages
emit `CreativeWork` — the honest supertype for photographic and film work,
needing no byline or publication instant the CMS does not hold — with a
breadcrumb trail; `/work`, `/services`, and `/contact` emit trails only. Every
field comes from CMS content or the configured origin, and a field with no
source is omitted, so an empty CMS yields identity and nothing else: no address,
rating, price, award, or founding date is fabricated. Values are serialized with
`<`, `>`, and `&` escaped, losslessly, so no CMS value can close the script
element. No `Person` node is published anywhere. An earlier Phase 9 draft named
one from `studioName`; independent review rejected that, and rightly. A `Person`
asserts that a named natural person exists, the CMS holds a single identity
field and nothing distinguishing a sole trader from a company, and inventing an
owner's real name is not an option — so for a studio trading as a company the
node would be a machine-readable falsehood. `Organization`/`ProfessionalService`
already carries the identity, contact details, and social profiles, so omitting
it costs almost nothing. It becomes available the moment the CMS models an
explicit person name.

Analytics and monitoring are optional, and absent configuration is a valid
state that warns about nothing. Umami is disabled unless a website id is set,
and a non-HTTPS or malformed tracker URL disables it rather than emitting a
broken tag. It is mounted once, in the public layout only, under a stable
element id that Next.js deduplicates by, so a future layout nesting mistake
still loads one tracker and counts one view. The admin area is never measured:
its URLs carry record identifiers and its page views are not useful data. Route
changes need no code — the Umami tracker patches the History API itself. Umami
is cookieless and stores nothing in the browser, so no consent banner is added,
consistent with ADR 0008.

Error monitoring uses the official `@sentry/nextjs` SDK (10.74.0). An earlier
Phase 9 draft spoke Sentry's envelope endpoint directly from a dependency-free
module; that is rejected. Maintaining a partial implementation of someone else's
wire protocol means owning their compatibility surface forever while getting
none of the framework integration they maintain — and the privacy analysis that
made the custom transport attractive turned out to be the argument against it,
because the SDK's own collection switches are far more precise than anything
worth hand-writing. The costs accepted in exchange are real and measured: the
SDK is bundled whether or not a DSN is set, taking shared First Load JS from
103 kB to 137 kB and the Edge middleware from 36 kB to 97 kB, after enabling the
SDK's tracing and replay tree-shaking options.

The architecture is the SDK's current one for the Next.js 15 App Router, taken
from the package and its documentation rather than from an older tutorial:
`src/instrumentation.ts` initializes the Node and Edge runtimes through
`register()` and exports `Sentry.captureRequestError` as `onRequestError`;
`src/instrumentation-client.ts` — not the obsolete `sentry.client.config.ts` —
initializes the browser; `sentry.server.config.ts` and `sentry.edge.config.ts`
hold the per-runtime `Sentry.init` calls; and `next.config.ts` is wrapped in
`withSentryConfig`. All three `init` calls spread one option object built by
`src/lib/monitoring/options.ts`, so a privacy decision cannot end up applying to
two runtimes out of three.

Reporting is production-only and DSN-gated. When it is off, `Sentry.init` is not
called at all — rather than called with an empty DSN — so no handler is
installed and no request can be made, and nothing warns, because running without
monitoring is a valid configuration. No Sentry account is needed to develop,
build, test, or verify. Server, Server Action, Route Handler, and middleware
errors are captured through the framework's single `onRequestError` hook, so no
failure path has to remember to report. Browser errors come from the root
`global-error` boundary and the public `error` boundary, both through one small
wrapper whose only job is avoiding a double report: an error carrying a `digest`
was thrown on the server and already captured there, and Next.js re-renders the
boundary with a redacted placeholder, so the wrapper skips it and reports only
genuine client-side failures.

Privacy is configured structurally rather than trusted to defaults. `sendDefaultPii`
is *not* relied on: in SDK v10 it resolves to a snippet denylist that still
attaches headers and cookies, and `onRequestError` puts the request headers —
including the administrator's Better Auth session cookie — onto the scope.
Instead every `dataCollection` switch is stated explicitly and set to its
narrowest value: no user info or IP, no cookies, no request or response headers,
no HTTP bodies, no URL query parameters, no database query data, and no stack
frame local variables. Every field is stated because supplying a partial
`dataCollection` object switches the fallbacks to the *permissive* set, so an
omitted field would collect more, not less. `BrowserTracing`, the two session
integrations, Node `Console`, and `LocalVariables` are removed from the
defaults. Tracing is off — no `tracesSampleRate`, no `tracesSampler`, the
integration removed, and `beforeSendTransaction` returning null. Session Replay
and profiling are never added. A `beforeSend` pass then deletes `user`,
`request.cookies`, `request.headers`, `request.data`, and `query_string` from
the outgoing event regardless of configuration, and `beforeBreadcrumb` drops
console breadcrumbs — this application logs the values it is working with — and
reduces breadcrumb URLs to origin and path.

Free text is scrubbed defensively on top of that: URL-embedded credentials,
email addresses, bearer tokens and keys, query strings, and long digit runs.
Honestly stated: that is pattern matching, not a proof. An exception message or
a stack frame can contain a string no pattern recognizes — an unusual address
format, a personal name, a fragment of an inquiry message — so the residual risk
is reduced, not eliminated. The structural switches above are the primary
control and the scrubbing is the backstop; neither is claimed to make leakage
mathematically impossible.

What an event *does* still carry was established by capturing a real envelope
from the SDK rather than by reading the configuration, and is pinned by
`src/lib/monitoring/envelope.test.ts` so an upgrade that adds a field fails a
test instead of reaching production: `server_name`, a dependency inventory in
`modules`, the `app`/`os`/`runtime`/`device`/`culture`/`cloud_resource`
contexts, and source `context_line` extracts around each stack frame. None of
these is personal data — on Netlify they describe an ephemeral container, not a
visitor — and each carries real diagnostic value, so they are disclosed here
rather than stripped. `modules` and the source extracts do disclose dependency
versions and application source to whoever can read the Sentry project, which is
a deliberate trade for readable stack traces.

That capture also confirmed the part that matters most: with an authenticated
admin request carrying a Better Auth session cookie, a bearer token, a Turnstile
token, and client-IP headers, the outgoing envelope's entire `request` object is
`{"method":"POST"}`, there is no `user`, and no stack frame carries local
variables.

Source-map symbolication is prepared but not enabled. `withSentryConfig` uploads
maps only when `SENTRY_AUTH_TOKEN` is present, so local and CI builds skip it
silently and no token is invented here; when a token is configured in Phase 10
alongside `SENTRY_ORG` and `SENTRY_PROJECT`, maps are uploaded and then deleted
from the deployed bundle, so traces are readable in Sentry without publishing
this application's source. The auth token is a secret, is build-time only, is
never referenced by application code, and never reaches the browser — the
verifier fails if any file under `src/` mentions it.

One DSN serves every runtime, `NEXT_PUBLIC_SENTRY_DSN`, because a DSN is public
by design — every Sentry browser SDK embeds it in the client bundle — so a
second unprefixed copy would protect nothing and could drift.

The Phase 8 header set is widened by exactly two directives, and only for
origins actually configured: the analytics tracker origin joins `script-src` and
`connect-src`, and the Sentry ingest origin joins `connect-src` only. That
origin was verified against the SDK's own endpoint builder rather than assumed,
and equals `new URL(dsn).origin`. No script origin is needed because the SDK is
bundled rather than fetched from Sentry, and server-side reporting is a Node
request subject to no browser policy. A malformed DSN is treated as
unconfigured, so it never reaches the policy. A deployment using neither service
keeps the Phase 8 policy byte for byte, and no wildcard is introduced.

`netlify.toml` publishes the Next.js build output through `@netlify/plugin-nextjs`
rather than a static export, keeping server rendering, ISR, on-demand
revalidation by tag, and the admin area. It declares no security header and no
cache rule for a rendered route: security headers stay owned solely by
`securityHeaders()` so one source of truth applies identically to `next dev`,
`next start`, and Netlify, and `Cache-Control` on rendered pages stays owned by
the Next.js runtime, because a blanket CDN rule would freeze stale pages and make
on-demand revalidation invisible. Only content-hashed build output, image-handler
output, fonts, generated metadata files, and the private admin area carry cache
rules. `npm run deploy:verify` fails if a security header or a route-level cache
rule appears in that file, if the publish directory becomes a static export, or
if a credential is committed to it.

## Limits

These are production-readiness measures, not a ranking, traffic, or reliability
guarantee. Structured data is a claim search engines may ignore, and no `Person`
node is published at all. The share-image fallback is typographic, not
photographic. The Sentry SDK costs roughly 34 kB of shared First Load JS even
when no DSN is set, which is a measured regression on an image-led site.

The Edge cost is larger and worth revisiting. The middleware entry now loads
`edge-instrumentation.js` (~179 kB built) on every cold start, purely to
initialize Sentry for a twenty-line cookie-presence check that performs no I/O;
`middleware.js` itself contains essentially no Sentry code. Dropping
`sentry.edge.config.ts` and the Edge branch of `register()` would remove that
cost while leaving Node and browser monitoring untouched, at the price of losing
middleware error reports — whose diagnostic value is near zero, because the real
authorization work happens in the Node runtime and is already covered. This is
recorded rather than done, because it changes monitoring coverage and should be
decided against a measured cold start in Phase 10.

`netlify.toml` declares `@netlify/plugin-nextjs` and `publish = ".next"`. Current
Netlify guidance is that the Next.js adapter is auto-provisioned and should not
be pinned or declared, and that the publish directory is handled by the adapter.
Both are retained because they cannot be validated without a real deploy, and
`npm run deploy:verify` currently *asserts* this shape — so Phase 10 must
re-validate the file against the live runtime and relax that assertion if the
adapter declaration is dropped. Netlify applies `X-Robots-Tag: noindex` to
Deploy Previews and branch deploys itself, so preview indexing needs no
application change; Phase 10 should confirm that on the first preview rather
than assume it.

Tracing, session tracking, and
Session Replay are off, so there is no performance data and no user journey to
inspect alongside an error. Source maps are configured but not uploaded until
Phase 10, so until then a minified client stack is read unsymbolicated. PII
scrubbing of free text is pattern matching and cannot be proven exhaustive.
Analytics attributes nothing to individuals by design, which also means no
funnels, cohorts, or user journeys. Verification is offline and
therefore cannot prove a crawler's behaviour, a real Netlify deploy, or a Core
Web Vitals score; Lighthouse and field measurement belong to Phase 11 after real
traffic exists. Netlify, Umami, Sentry, Search Console, DNS, and production
environment variables are configured in Phase 10, not here.
