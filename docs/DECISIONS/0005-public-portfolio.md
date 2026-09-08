# ADR 0005: CMS-backed public portfolio

## Status

Accepted for Phase 5.

## Context

Phases 2–4 established the database, the media pipeline, and the private CMS.
The public site was still Phase 1 placeholder copy. Phase 5 connects the two
without letting database concerns leak into the public UI, and without letting
unpublished content become reachable by guessing a URL.

## Decisions

### One server-side read layer

`src/server/public/` is the only place public pages touch Prisma.
`publication.ts` owns the filters, `queries.ts` owns the reads, and
`mappers.ts` converts rows into the explicit view models in `view-models.ts`.
Components receive finished view models, so a component cannot widen a `select`
or forget a publication filter, and internal columns — identifiers, audit
timestamps, uploader references, `status`, `featured`, storage keys — have no
path into public HTML. The mappers take an injected URL resolver and import
neither Prisma nor `server-only`, which makes every rule unit-testable without
a database.

### Publication is enforced in the query, never in the UI

Public reads compose `PUBLISHED_PROJECT_WHERE` (published, in an active
category) and `ACTIVE_WHERE`. Nothing is fetched and then hidden. A draft
project and a slug that never existed are therefore indistinguishable to the
detail route, which returns the same 404 for both and never hints that a draft
exists.

### Images are served straight from R2, not through `next/image`

Phase 3 already produces metadata-free WebP at 320/640/1280/1920 plus a capped
2560 master. Those are exactly the widths the layouts use, so the public site
emits a plain `srcset`/`sizes` pair with the R2 URLs and lets the browser
choose. Routing them through the Next.js optimizer would re-encode an already
optimal file on every cold request and add per-request compute on the hosting
platform for no quality gain, while also requiring a remote-host allowlist.

The cost is that `next/image` features are unavailable, so the responsibilities
it would have covered are handled explicitly: intrinsic `width`/`height` are
always emitted to reserve layout space, the Phase 3 blur placeholder is applied
as a CSS background, everything below the fold is `loading="lazy"`, and exactly
one image per page (the hero or project cover) is eager and high priority.

Selection is capped by layout: cards ask for at most 720 CSS pixels and detail
images for 1920, and `selectImageCandidates` never offers the master when a
smaller variant already covers the layout. URLs come from
`src/server/media/delivery.ts`, which needs only `R2_PUBLIC_BASE_URL` — no
bucket name, account id, or host appears in a component, so moving to a custom
media domain or another provider is a one-file change.

### Video is provider-neutral, click-to-load, and privacy-enhanced

The schema gained `videoProvider`/`videoId`/`videoTitle` on `Project` and
`showreelProvider`/`showreelVideoId`/`showreelTitle` on `SiteSetting`, plus a
`VideoProvider` enum — an additive migration with every column nullable. This
follows the shape `docs/ARCHITECTURE.md` already anticipated for video.

Only a provider and that provider's own identifier are stored. Embed URLs are
built in `src/lib/video.ts`, so no iframe markup, embed script, or arbitrary URL
ever comes from content, and an identifier that does not match the provider's
shape is rejected rather than interpolated into a URL. A dedicated video model
was rejected as overbuilding: one film per project and one showreel is the
actual requirement.

The player requests nothing from the provider until the visitor presses play —
no iframe, no script, no cookie, and deliberately not the provider's poster
image, since fetching that would already leak the visitor's IP address and
referrer. YouTube uses `youtube-nocookie.com`; Vimeo is asked not to track. The
trigger is a real `<button>`, so keyboard activation and focus work without
extra handling.

### Caching: tag-invalidated data, statically rendered pages

Public reads are wrapped in `unstable_cache` with per-entity tags, and mapping
happens inside the cache so what is stored is plain serializable data rather
than Prisma rows. Every admin mutation calls `revalidatePublicContent`, which
purges the affected tags and the routes that render them, so a save is visible
immediately. A one-hour `revalidate` bounds staleness if an invalidation is
ever missed.

`/`, `/about`, `/services`, and `/contact` are statically rendered with ISR.
`/work/[slug]` is pre-rendered from `generateStaticParams` for published slugs,
with `dynamicParams` left at its default so work published after a build still
renders on demand and is then cached — new projects appear without a redeploy.
`/work` is rendered per request because it accepts a `?category=` filter; its
queries are cached and tagged, so a request that follows no admin save performs
no database work.

**No `loading.tsx` may sit above `/work/[slug]`.** A streaming boundary commits
HTTP 200 before `notFound()` runs, which turns every draft and unknown slug into
an indexable soft 404. This was observed and fixed during Phase 5 verification;
the Phase 5 route-level 404 guarantee depends on it.

### Category filtering uses links, not client state

Filtering is plain server-rendered links with a query string: no client state,
shareable URLs, working browser history, and no JavaScript required. Only
active categories that contain published work are offered, so a filter can
never lead to an empty result, and an unknown slug falls back to the full
portfolio rather than a 404.

### The contact page collects nothing

Phase 5 ships contact details only. A form that could not deliver a message
would be worse than no form, so the inquiry model, validation, persistence, and
notification stay in Phases 6–7.

### Alt text is never invented

`Media.altText` is used as written. An image without alt text renders
`alt=""` — marking it decorative rather than announcing a filename or a guess
about the photograph — and the surrounding title and copy carry the meaning.

## Consequences

- Public rendering works on a deployment holding no R2 *write* credentials.
- Changing image provider, adding a variant width, or adding a video provider
  each touch one module.
- `next/image` optimization is unavailable on the public site; layout stability
  and lazy loading are handled explicitly instead and must stay that way.
- A future `loading.tsx` in the public route group would silently break the
  404 guarantee. It is called out in the route file and here.
