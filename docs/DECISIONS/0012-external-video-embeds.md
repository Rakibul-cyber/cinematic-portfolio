# ADR 0012: External video embeds instead of uploaded video

| Field | Value |
| --- | --- |
| Status | Accepted (owner decision, 2026-11-07) |
| Task | MH-10 |
| Supersedes | The Mux upload and streaming MVP (P3-11A to P3-11E), never released |

## Context

The video MVP (P3-11A–E) uploaded files to Mux, tracked processing through
webhooks, and played signed HLS streams. It added two tables, a migration,
five secrets, two client libraries, a widened CSP, and an untested concurrency
model, and it needed a Mux account and integration testing before release.

The owner's requirement is simpler: Munir uploads his own portfolio films to
YouTube or Google Drive himself, pastes the link in the admin, and visitors
watch the embed on the project page. No video file is stored by the site.

## Decision

1. Remove the Mux implementation completely: services, routes, admin library,
   picker, Films section, HLS player, `@mux/upchunk`, `hls.js`, the `MUX_*` and
   `VIDEO_*` variables, the `Video` and `ProjectVideo` models, and the unapplied
   migration `20261106120000_add_uploaded_video`.
2. Keep the existing per-project embed (`project.videoProvider`, `videoId`,
   `videoTitle`; one video per project) and add `GOOGLE_DRIVE` to
   `VideoProvider` with one additive migration.
3. The admin pastes a link. `parseEmbeddableVideoUrl` matches hosts exactly and
   keeps only provider and ID; embed URLs are built in `src/lib/video.ts` and
   never come from content. Drive accepts file links only and embeds
   `https://drive.google.com/file/d/<id>/preview`.
4. The public player stays click-to-load. The project cover image (local WebP)
   is the thumbnail, so no request reaches a provider before Play.
5. CSP: `https://drive.google.com` joins `frame-src`; nothing else changes.

## Consequences

- No video storage, streaming, webhook, or provider secret to operate.
- One video per project; visibility follows the project's publish status.
- Unlisted Vimeo links are refused (their privacy hash is not stored).
- Google Drive is a file-sharing player, not a streaming service: files must be
  shared as "Anyone with the link", very large files can take long to process,
  and heavily viewed files can hit Drive's viewing limits. YouTube (unlisted is
  fine) is the more robust host for showreels.
- The removed code remains in git history (`18a6f76`…`186d489`).
