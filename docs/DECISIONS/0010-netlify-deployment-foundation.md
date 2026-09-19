# ADR 0010: Netlify deployment foundation

## Status

Accepted for Phase 10A, with the deployment itself outstanding. Supersedes the
`netlify.toml` and Edge-monitoring paragraphs of
[ADR 0009](0009-seo-production-deployment.md).

## Context

Phase 10A is the first production-deployment checkpoint: deploy the existing
application to a temporary Netlify site and validate the real Next.js runtime,
without changing product behaviour. Two questions were explicitly deferred to it
by Phase 9 — whether `netlify.toml` matched current Netlify guidance, and
whether initializing Sentry in the Edge runtime earned its cost.

Both are resolved below. The deployment itself is not: this repository has no
authenticated Netlify access, so everything that requires a live deploy remains
unverified and is listed as such rather than assumed.

## Decision

### Zero-configuration adapter

Netlify's current guidance is that "Next.js is supported natively on Netlify,
and in most cases you will not need to install or configure anything" — the
OpenNext adapter is provisioned automatically and owns the build output, the
serverless and edge functions, ISR, on-demand revalidation, and image handling.
Declaring `[[plugins]] @netlify/plugin-nextjs` is the *pinning* pattern, and
Netlify recommends against pinning: it maintains the adapter for every Next.js
release from 13.5 and uses the latest on each build unless told otherwise.

So `netlify.toml` no longer declares the plugin and no longer sets `publish`.
Naming a publish directory freezes an assumption about adapter internals whose
failure mode is a green deploy that serves 404s — the worst kind, because it
looks like success. What remains is the build command (explicit, so framework
detection is never load-bearing), `NPM_FLAGS=--include=dev` (Prisma generates
the client in `postinstall`; TypeScript and Tailwind run during the build), and
two header rules.

### Node.js version

Pinned to 22 in `.node-version`. That file is the highest-precedence mechanism
Netlify reads, and unlike `NODE_VERSION` in `netlify.toml` it is visible to
every other tool in the repository. Netlify does not read `package.json`
`engines`, so that is not the mechanism to use here. Node 22 is LTS and
satisfies Next.js 15.5, Prisma 7, and Sharp 0.35.

Known skew: local development currently runs Node 24. Nothing in the project
requires it, but build and runtime should be aligned before launch — either by
raising `.node-version` to 24 or by developing on 22.

### Cache rules

Only two survive, and the rule is now stated as an invariant rather than a list:
**everything Next.js renders is the runtime's to cache.** That includes
`/sitemap.xml`, `/robots.txt`, and `/opengraph-image`, which are Next.js
metadata routes carrying their own `revalidate`, not static files. Phase 9 gave
the first two CDN rules; that was a mistake against its own stated principle,
and a CDN rule on a route with `revalidate` freezes exactly the staleness it was
meant to prevent. They are removed.

`/_next/static/*` keeps `immutable` because it is the one path whose bytes can
never change under a given URL — content-hashed build output, including the
fonts `next/font` emits to `/_next/static/media/`.

`/admin/*` keeps `private, no-store` as a deliberate exception to the invariant.
The application already sends it on every admin response; stating it at the edge
too is fail-safe in the only direction that matters, because over-restricting a
private surface cannot leak it while under-restricting one can.

Two rules are deleted as dead configuration: `/_next/image*` (the Next.js image
optimizer is unused — ADR 0005 serves R2 variants directly through `srcset`) and
`/fonts/*` (there is no `public/` directory). Configuration that describes a
architecture the application does not have is worse than no configuration,
because the next reader believes it.

`npm run deploy:verify` was rewritten to assert these invariants rather than the
previous file's shape: nothing pinned, no publish directory, an explicit
`.node-version`, `immutable` only on content-addressed paths, no cache rule on a
rendered route, no rule matching a path the application does not deploy, and no
security header or credential in the file.

### Edge Sentry removed

Two full builds, identical except for Edge initialization:

| | Edge Sentry on | off | change |
| --- | --- | --- | --- |
| Reported middleware bundle | 96.9 kB | **41.5 kB** | −57% |
| `edge-instrumentation.js` | 179,112 B | 11,422 B | −93.6% |
| Total edge bundle | 290,772 B | 123,055 B | −57.7% |
| `middleware.js` | 110,156 B | 110,129 B | unchanged |
| Client First Load JS | 137 kB | 137 kB | unchanged |

`middleware.js` being unchanged is the telling number: Sentry was never
meaningfully inside the middleware. The entire cost was a separate
instrumentation bundle loaded on every Edge cold start — that is, on every
`/admin` request — to watch twenty lines that read a cookie, redirect, and set a
cache header, with no database, no network, and no parsing of untrusted input
beyond the cookie header.

`src/middleware.ts` documents itself as routing convenience rather than an
authorization control, and the authorization it fronts runs in the Node runtime,
where `onRequestError` already reports. A middleware crash also still surfaces
in the host's own function logs. So the diagnostic loss is close to nothing and
the saving is 57% of the edge bundle. `sentry.edge.config.ts` and the Edge
branch of `register()` are removed; Node and browser monitoring are untouched.

For reference, the pre-Phase-9 middleware was 36.3 kB, so 41.5 kB is
approximately back to baseline: the residual ~5 kB is the instrumentation hook
itself.

### Preview database

The configured Neon branch is named `production`. It is empty today — zero
customers, inquiries, notes, users, media, and projects — but a public preview
pointed at it would *write* to it: every inquiry submitted by anyone who finds
the URL, plus the Phase 8 rate-limit buckets, would become rows on the branch
intended for launch.

**A Phase 10A preview must use a separate Neon branch**, not `production`. This
is a configuration decision for the operator, taken before the first deploy, not
something the application can enforce.

### What production fails closed without

On Netlify, `NODE_ENV` is `production`, which changes Phase 8 behaviour by
design:

- **Turnstile**: without both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`,
  verification returns `misconfigured` and every inquiry submission is rejected.
- **Rate limiting**: without a `RATE_LIMIT_HMAC_SECRET` of at least 32
  characters, `consumeInquiryLimit` returns `allowed: false` and every inquiry
  submission is rejected.

Both are correct and deliberate. Phase 10A does **not** add a preview bypass:
weakening an abuse control to make a preview convenient is how such controls
stop being controls. A preview therefore either configures Turnstile (Cloudflare
publishes always-pass testing keys for exactly this) plus a rate-limit secret,
or accepts that the inquiry form fails closed and validates the read-only
surface only.

### Canonical origin on a temporary host

`BETTER_AUTH_URL` is required for the application to boot and must equal the
deployment origin for authentication to work. It is also the fallback canonical
origin when `NEXT_PUBLIC_SITE_URL` is unset. On a temporary Netlify host that
means the preview hostname becomes the canonical origin, and appears in
canonical links, Open Graph URLs, JSON-LD `@id` values, and the sitemap.

That is acceptable only because Netlify applies `X-Robots-Tag: noindex` to
Deploy Previews and branch deploys, which keeps those URLs out of search
regardless of what the page claims about itself. It must be confirmed on the
first real preview rather than assumed, and the production `NEXT_PUBLIC_SITE_URL`
must be set before any indexable deploy.

## Limits

The deployment itself has not happened. Everything requiring a live Netlify
environment is unverified: adapter detection, build and deploy logs, SSR, ISR
and on-demand revalidation against the real runtime, actual response headers,
`X-Robots-Tag` on previews, function cold-start behaviour, Prisma connection
behaviour under serverless concurrency, Sharp's Linux binary, R2 media loading
from a deployed origin, and Server Action execution. The measurements above are
build-output measurements, not runtime ones.

`src/middleware.ts` still emits the documented `jose`/`CompressionStream` Edge
warning from a transitive Better Auth import. The code path is JWE decryption,
which the middleware never reaches. Switching the middleware to the Node.js
runtime would silence it, but whether Netlify's adapter supports Node.js
middleware is exactly the kind of claim that needs a deploy to settle, so it
stays deferred.

Custom domain, DNS, production credentials, Search Console, backups, and
production service configuration all belong to Phase 10B and later.
