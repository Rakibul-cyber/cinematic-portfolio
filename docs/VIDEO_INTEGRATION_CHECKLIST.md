# Video release checklist (external embeds)

| Field | Value |
| --- | --- |
| Task | MH-10 ([ADR 0012](DECISIONS/0012-external-video-embeds.md)) |
| Replaces | The Mux integration checklist (MH-08/MH-09), obsolete since Mux was removed |
| Code | `feature/external-video` (LOCAL ONLY). Nothing is merged, published, or applied. |

**[OWNER]** marks a step that needs the owner's explicit authorization in that
task (CLAUDE.md). Tick a box only with evidence.

## 1. Release

- [ ] **[OWNER]** Back up production: note the UTC time (Neon point-in-time
      restore) and, if wanted, `pg_dump -Fc` to a file outside the repository.
- [ ] **[OWNER]** `npm run db:migrate:status`: exactly one pending migration,
      `20261107120000_add_google_drive_video_provider`.
- [ ] **[OWNER]** Apply it:
      `npx tsx scripts/prisma-guarded.ts migrate-deploy --allow-production`
      (typed endpoint confirmation), then `db:migrate:status` again.
- [ ] **[OWNER]** Merge to `main` and push. Netlify builds; Auto Publishing
      stays locked. Do not change Netlify configuration.
- [ ] **[OWNER]** Check the deploy permalink, then publish it.

No environment variable is needed. If any `MUX_*` or `VIDEO_*` variable exists
in Netlify, it is now unused and can be removed later.

## 2. Smoke test (published site)

- [ ] Home, `/work`, a project page, contact page (intake still closed), and
      admin login work; the browser console shows no CSP error.
- [ ] Admin: paste a YouTube link into a project's **Video link**; it shows
      "Detected: YouTube" and a preview. Save, publish: the project page shows
      the cover with a Play button, and the film plays after Play.
- [ ] The same with a Google Drive file shared as "Anyone with the link", on
      desktop and on a phone.
- [ ] An unsupported link (for example a Drive folder or a website) is refused
      with a message; clearing the link removes the film.
- [ ] Unpublishing the project hides the page (404) and its film.

## 3. Rollback

1. **Application:** republish the previous Netlify deploy. Its Prisma client
   does not know `GOOGLE_DRIVE` and may fail to read a project that uses it, so
   **first** clear those rows **[OWNER]**:
   `UPDATE "project" SET "videoProvider" = NULL, "videoId" = NULL, "videoTitle" = NULL WHERE "videoProvider" = 'GOOGLE_DRIVE';`
   (and the same for `site_setting.showreelProvider` if the showreel uses Drive).
   Before any Drive link is saved, nothing needs clearing.
2. **Database:** otherwise nothing to do; the extra enum value is harmless.
   PostgreSQL cannot drop an enum value in place, so removing it means
   rebuilding the type or restoring the backup. **[OWNER]**
