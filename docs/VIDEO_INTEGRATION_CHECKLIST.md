# Video MVP: integration readiness checklist

| Field | Value |
| --- | --- |
| Task | MH-08 (Part C); revised in MH-09 (sections 2 and 12) |
| Code | `feature/video-upload-backend` at `624250f` (Better Auth 1.7.18 on top of P3-11E). Nothing is merged, published, or applied. |
| Written | 2026-11-06, revised 2026-11-07, without connecting to any external service |

**[OWNER]** marks a step that needs the owner's explicit authorization *in that
task* (CLAUDE.md). Unmarked steps run only against disposable resources and need
no production access. Tick a box only with evidence: a log, a screenshot, or a
command output. Otherwise write UNVERIFIED.

## 0. Ground rules

- [ ] Every step below uses a **disposable Neon branch** and an **unpublished
      Netlify deploy preview**. Neither the production database nor the
      published site is touched until section 11.
- [ ] Secrets go only into Netlify environment variables (deploy-preview scope)
      or a local `.env.local`. They are never pasted into chat, logs, commits,
      or `.env.example`.
- [ ] A full `next build` needs a reachable database. Point it at the
      disposable branch, never at production.

## 1. Disposable Neon database: migration and rollback (P4-03)

- [ ] **[OWNER]** Create a Neon branch from production, or an empty project,
      for testing. Neon branch creation is an external action.
- [ ] Set `DATABASE_URL` to that branch only, then run `npm run db:migrate:status`.
- [ ] Apply all migrations with `npm run db:migrate:deploy`, which is guarded.
      Record the output. The video migration
      `20261106120000_add_uploaded_video` is additive: the `VideoStatus` type
      and the `video` and `project_video` tables, with no existing table changed.
- [ ] Check the schema: three unique indexes on `video` (upload, asset,
      playback IDs). The `project_video → video` key is `RESTRICT`;
      `project_video → project` is `CASCADE`; `video → user` is `RESTRICT`.
- [ ] Rollback rehearsal on the same branch:
      `DROP TABLE "project_video"; DROP TABLE "video"; DROP TYPE "VideoStatus";`,
      then delete that migration's row from `_prisma_migrations`, then
      re-apply. Record that both directions succeed.
- [ ] Run the existing integration suite: `npm run integration:preflight`, then
      `integration:identity` and `integration:run`.
      **[OWNER]** CLAUDE.md requires authorization to run them.

## 2. Video PostgreSQL suite (written in MH-09; NOT RUN)

`scripts/integration/video.integration.ts` runs as one step of
`integration:run` **[OWNER]**, after the branch is verified, marked, and
migrated. Mux is a local fake; no provider request is made. Started any other
way, it refuses before loading a driver (`video-suite-gate.ts`). The settings
file must name both `PRODUCTION_DATABASE_ENDPOINT` and
`PROTECTED_DEVELOPMENT_ENDPOINT`; the harness refuses either. It refuses
a database that is empty, unmarked, or missing the video migration. Record
the step's pass and fail counts. The suite covers:

- [ ] **Migration:** replayed in a scratch schema, the video migration leaves
      every existing table, key, index, type, and row unchanged; the rollback
      statements in section 1 restore the previous schema exactly; re-applying
      works. `public` is never touched by this test.
- [ ] **Uploads:** two concurrent uploads by one user give two rows; six
      concurrent requests give exactly two (no orphan provider upload); ten
      parallel repository inserts give two; a held advisory lock blocks only
      that uploader; cancellation and expiry free a slot.
- [ ] **Transitions:** a wrong expected status changes nothing; one of eight
      identical and one of two competing updates wins; an update waiting on a
      row lock re-checks the status after the other session commits.
- [ ] **Webhooks:** four concurrent duplicates of `video.asset.ready` give one
      READY row and one audit transition; late and out-of-order events leave
      READY unchanged; an asset arriving after cancellation is deleted; a
      DELETING row is untouched; an unknown upload is ignored.
- [ ] **Assignment versus deletion:** both orders, forced with a lock-holding
      session, plus 20 unsynchronised races: never assigned while DELETING or
      gone. Two saves sharing videos in opposite order do not deadlock.
- [ ] **Shared video:** deletion is refused while any project uses it, the
      `RESTRICT` key stops a direct row delete, and it succeeds once
      unassigned; deleting a project removes only its own assignments.
- [ ] **Rollback:** a non-READY video, a failing foreign key, a stale version,
      or a duplicate slug leaves the project, its media, and its videos unchanged.

## 3. Mux account and test environment

- [ ] **[OWNER]** Create or confirm the Mux account and a **separate test
      environment**. Check the plan, the pricing, and the data-processing terms.
      Account creation and billing are owner decisions.
- [ ] Decide the asset settings the code expects: signed playback only, and
      the maximum resolution and duration for the trial.

## 4. Mux API credentials and signing keys

- [ ] **[OWNER]** Create an access token in the test environment with only the
      permissions needed (Mux Video: read and write). Set `MUX_TOKEN_ID` and
      `MUX_TOKEN_SECRET` on the deploy-preview scope only.
- [ ] **[OWNER]** Create a signing key. Set `MUX_SIGNING_KEY_ID` and
      `MUX_SIGNING_PRIVATE_KEY` (base64 PEM, as `.env.example` describes).
- [ ] Confirm that `/admin/videos` no longer shows "video not configured", and
      that no `MUX_*` value appears in the browser (view source, network tab).
- [ ] Rotation drill: revoke and replace the token, then confirm the uploads work.

## 5. Mux webhook

- [ ] **[OWNER]** Add a webhook in the Mux test environment pointing to
      `https://<deploy-preview-host>/api/webhooks/mux`. Set `MUX_WEBHOOK_SECRET`.
- [ ] Confirm that an unsigned or tampered request gets a refusal, and a real
      event gets 200.
- [ ] Record the event types actually received (upload created, asset
      created, ready, errored, deleted) against the ones the code handles.
      The names are UNVERIFIED until the trial (MH-02D).

## 6. Upload and playback hosts

- [ ] Start one upload. In the network tab, record the **exact origin** of the
      direct-upload `PUT` requests.
- [ ] Set `VIDEO_UPLOAD_ORIGIN` to that one https origin. It is read at build
      time, so a rebuild is needed.
- [ ] Play one video. Record every origin that serves playlists and segments.
      If any is not `https://stream.mux.com`, set `VIDEO_PLAYBACK_ORIGINS`
      (comma-separated https origins, no wildcards) and rebuild.
- [ ] Confirm that an upload URL on any other origin is refused by the page.

## 7. CSP on an unpublished deploy preview

- [ ] **[OWNER]** Create a deploy preview of the branch. Do not change Netlify
      Auto Publishing or its lock.
- [ ] Check the `Content-Security-Policy` response headers:
  - [ ] Any page, for example `/`: unchanged. `connect-src` has no Mux host,
        and `media-src` is `'self'`.
  - [ ] `/admin/videos`: adds the playback origins and `VIDEO_UPLOAD_ORIGIN`
        in `connect-src`, plus `blob:` and the playback origins in `media-src`.
  - [ ] `/work/<slug>`: playback origins only, and never the upload origin.
- [ ] The browser console shows no CSP violation during upload, preview, and
      public playback.

## 8. Real 4K upload and adaptive playback

- [ ] Upload a real 4K file of several GB. Watch the progress bar. Switch the
      network off and on during the upload and confirm it resumes.
- [ ] The status moves Uploading → Processing → Ready. The duration and
      resolution (for example `3840 × 2160 (2160p)`) are correct.
- [ ] Admin preview plays. Throttle the network and confirm the quality
      adapts. Let the 15-minute token expire during playback and record what
      happens.
- [ ] Upload a non-video file renamed `.mp4`. It ends as Failed with a known
      message, never provider text.

## 9. Cancel, unpublish, remove, and permanent delete

- [ ] **Cancel** during an upload: the video is Cancelled, and a late Mux
      asset is deleted (it does not appear in the Mux dashboard).
- [ ] **Assign** to a draft project. The public page returns 404, and playback
      with that `projectId` is refused.
- [ ] **Publish:** Films appear in saved order. Play loads only the clicked film.
- [ ] **Unpublish**, or deactivate the category: the page returns 404, and an
      open player's next token request is refused.
- [ ] **Shared video** in two projects: unpublishing one leaves it playable
      on the other.
- [ ] **Remove** from a project: the video stays Ready in the library.
- [ ] **Delete** is refused while the video is assigned. After removing it,
      delete it and confirm the asset is gone in Mux.
- [ ] **Delete failure:** revoke the token, try to delete, and see
      "Delete failed". Restore the token, use Retry delete, and confirm it
      succeeds.
- [ ] **EDITOR** account: no Videos link, `/admin/videos` returns 403, and
      the project editor shows videos read-only.

## 10. Browsers

- [ ] Chrome, Firefox, Edge (hls.js), Safari macOS, and iOS Safari (native HLS).
- [ ] Android Chrome for public playback.
- [ ] Keyboard only and a screen reader for the picker (Up, Down, Remove, and
      the live announcements) and the Play button.

## 11. Release and rollback

- [ ] **[OWNER]** Commit, push, and merge `feature/video-upload-backend`.
      This includes the Better Auth 1.7.18 update once it is reviewed.
- [ ] **[OWNER]** Back up the production database with a Neon restore point,
      then apply the migration (`npm run db:migrate:deploy --allow-production`
      with the typed confirmation).
- [ ] **[OWNER]** Set the production `MUX_*` and `VIDEO_*` variables (the
      production Mux environment), and point the production webhook at the
      live domain.
- [ ] **[OWNER]** Publish.

## 12. Backing out: four separate actions

Use the lightest one that solves the problem. Each is independent; only the
order in 12.3 and 12.4 matters. Every step here is **[OWNER]** in production.

### 12.1 Feature disablement (minutes; nothing is lost)

- **[OWNER]** Remove any one `MUX_*` variable in Netlify (production scope),
  then trigger a redeploy. Variables apply only to new deploys.
- Effect: the video routes answer 503 ("not configured"); uploads, admin
  preview, and public playback stop; webhooks get 503, so Mux retries them
  for a while. Rows and Mux assets stay; the rest of the site is unaffected.
- Undo: restore the variable and redeploy.

### 12.2 Application rollback (minutes; database untouched)

- **[OWNER]** In Netlify, publish the previous production deploy
  (`main@288fde6` as owner-reported). Do not change Auto Publishing or its lock.
- The old code ignores the `video` and `project_video` tables. Its webhook
  path returns 404: **[OWNER]** disable the webhook in the Mux dashboard so
  Mux stops retrying.
- Undo: republish the newer deploy.

### 12.3 Database rollback (only if the tables must go)

Prefer keeping the additive tables: they cost nothing while unused.

1. Roll back the application first (12.2). The new code fails without the tables.
2. **[OWNER]** Create a Neon restore point (or a branch) of production.
3. **[OWNER]** Export `id`, `muxUploadId`, `muxAssetId`, and `status` from
   `video`. This is the only record of which Mux assets belong to the site;
   12.4 needs it.
4. **[OWNER]** Run in one transaction the section 1 `DROP` statements, then
   `DELETE FROM "_prisma_migrations" WHERE migration_name = '20261106120000_add_uploaded_video';`.
   Avoid a point-in-time restore: it would also discard inquiries and other
   data written since.
- Undo: `npm run db:migrate:deploy --allow-production` re-creates empty tables;
  assignments are lost.

### 12.4 Mux asset cleanup (irreversible; billing stops)

1. Only after 12.3, or after confirming no `READY` row still needs the asset.
   Deleting an asset in use breaks its Films at once.
2. Compare the assets in the Mux environment with the export from 12.3 (or
   the live `video` table). Delete only assets whose passthrough is one of
   the site's video IDs.
3. **[OWNER]** Delete them in the Mux dashboard or API, in the right
   environment (test or production).
4. **[OWNER]** If video is abandoned: delete the webhook, revoke the access
   token and signing key, and remove the remaining `MUX_*` variables.

## Owner approvals for real external operations

| Operation | Section |
| --- | --- |
| Create or delete a Neon branch | 1 |
| Run `integration:identity` (read-only) and `integration:run` (writes to the disposable branch) | 1, 2 |
| Create the Mux account, test environment, token, signing key, webhook | 3–5 |
| Set or change Netlify variables; create a deploy preview | 4, 6, 7, 12.1 |
| Push, merge, publish, or republish a deploy | 11, 12.2 |
| Production backup, migration, export, or `DROP` | 11, 12.3 |
| Delete Mux assets; revoke credentials | 12.4 |
