# Video MVP: integration readiness checklist

| Field | Value |
| --- | --- |
| Task | MH-08 (Part C) |
| Code | `feature/video-upload-backend` at `186d489` (P3-11E). Nothing is merged, published, or applied. |
| Written | 2026-11-06, without connecting to any external service |

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

## 2. PostgreSQL concurrency tests (still to be written; BLOCKED until 1)

Two real connections, each a `BEGIN … COMMIT`, run in both orders:

- [ ] **Delete versus assignment:** session A locks video V for assignment
      (`… FOR UPDATE`), and session B's `beginDeletion(V)` waits. After A
      commits, B is refused with `delete_assigned`. In the reverse order the
      save is refused (V is DELETING) and no `project_video` row exists.
- [ ] **Two saves sharing videos:** project P saves `[V1, V2]` while project Q
      saves `[V2, V1]`. Neither deadlocks, because locks are taken in id order.
- [ ] **Concurrent uploads:** N parallel `createUploadSession` calls for one
      user never exceed the active-upload limit (advisory lock).
- [ ] **RESTRICT key:** `DELETE FROM video` with an assignment present fails.
- [ ] **Webhook race:** a duplicated `video.asset.ready` event applied twice
      leaves one consistent READY row.

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
- **Rollback, fastest first:**
  1. Unset the `MUX_*` variables and redeploy. Video turns off
     ("not configured"), and the rest of the site is unaffected.
  2. Republish the previous deploy in Netlify (published today:
     `main@288fde6`, as the owner reported). The new tables stay in place and
     are unused by the old code.
  3. Database: prefer leaving the additive tables. To remove them, first delete
     the Mux assets (or keep the Mux environment), restore from the backup or
     run the rehearsed `DROP` statements from section 1, and remove the
     `_prisma_migrations` row. **[OWNER]**
