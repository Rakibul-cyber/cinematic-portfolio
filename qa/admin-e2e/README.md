# Admin end-to-end checks (signed in)

Browser checks for the Munir Visuals admin at https://munirvisuals.com. This
folder is separate from the application: it has its own dependency
(`playwright-core`, which drives the Chrome already installed on the computer)
and is never installed or run by the site build.

## Read-only run

It signs in once, looks at every admin section on a desktop-sized and a
phone-sized screen, and signs out. About 85 checks, a few minutes.

**It cannot change data.** Every request that would create, change, or delete
something is blocked inside the browser. The only exceptions are the sign-in
and the sign-out. Export links are never followed.

**What it leaves behind:** two audit entries (signed in, signed out). The
session it creates is revoked by the sign-out.

**Your password** is typed at a hidden prompt. It stays in memory for the one
sign-in and is never printed, saved, or sent anywhere except the site's own
sign-in. The session cookie is never written to disk.

### Steps (Windows)

1. Open **Windows PowerShell** yourself (Start menu). Do not use a terminal
   that another tool controls.
2. Go to this folder:

   ```powershell
   cd C:\Users\RAKIB\Projects\cinematic-portfolio\qa\admin-e2e
   ```

3. First time only:

   ```powershell
   npm install
   ```

4. Run:

   ```powershell
   npm run readonly
   ```

5. Type the admin email and press Enter. Type the password and press Enter;
   nothing appears while you type, which is expected.
6. Wait for the line beginning `Total`. Results are saved to
   `out\readonly-results.md`.

To watch the browser while it works: `npm run readonly:headed`.

### If sign-in is refused

The suite makes **one** attempt and stops. Do not run it again and again: the
site allows 6 sign-in attempts per account in 15 minutes and then refuses
everyone, including you, until the 15 minutes pass. Check the email and
password by signing in normally in your browser first.

### Results

`out\readonly-results.md` and `out\readonly-results.json` hold a status and a
short piece of evidence per check: counts, page names, and HTTP statuses. They
contain no passwords, cookies, customer names, emails, or message text, so
they are safe to share. The `out` folder is ignored by git.

Statuses: `PASS` ran and worked; `FAIL` ran and did not; `NOT RUN` could not
run because the data it needs does not exist (for example, no inquiries yet);
`BLOCKED` could not run because an earlier step failed.

## Write tests

Not included. They need a separately approved test-data plan; see
`docs/ADMIN_QA_REPORT.md`.
