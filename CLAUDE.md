# CLAUDE.md: Munir Visuals

Mandatory instructions for Claude Code in this repository. The details live in
the Context Architecture; this file is the checklist. If anything here conflicts
with an owner instruction in the conversation, the owner wins. Otherwise these
rules are binding.

## Read first, every task

1. [docs/01_PRD.md](docs/01_PRD.md): requirements, release gates
2. [docs/02_AppFlow.md](docs/02_AppFlow.md): routes, screens, state machines
3. [docs/03_UI_Spec.md](docs/03_UI_Spec.md): design tokens and components
4. [docs/04_TRD.md](docs/04_TRD.md): stack, endpoints, security, deployment, defects
5. [docs/05_Schema.md](docs/05_Schema.md): tables and authorization model
6. [docs/06_Plan.md](docs/06_Plan.md): task tracker and decision register

Also follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and the ADRs in
[docs/DECISIONS/](docs/DECISIONS/).

## Workflow for every implementation task

1. Read all six documents above.
2. Inspect the relevant source files; the repository is the evidence.
3. Identify the task ID in `docs/06_Plan.md`. If none exists, stop and ask.
4. Confirm the scope and that the task's dependencies are met.
5. Check `git status` and the current branch. Never assume `main`.
6. Review the security and production risks of the change.
7. Present a short implementation plan before editing.
8. Make only the authorized changes, scoped to the task.
9. Run the relevant tests: `npm test`, `npm run typecheck`, `npm run lint`,
   `git diff --check`, plus any task-specific verification.
10. After verified completion, update `docs/06_Plan.md` using its
    "Mandatory task-update procedure".
11. Update any architecture document (01–05) whose contract changed.
12. Report the changed files, test results with counts, blockers, and `git status`.
13. Never claim success that was not verified. Say NOT RUN, BLOCKED, or UNVERIFIED.

## Prohibited without explicit owner authorization in the current task

- Production database access or writes, including read-only queries
- Creating a production administrator (`npm run admin:bootstrap` against production)
- `git push`, merging branches, rewriting history, force-push
- Deploying or publishing; changing Netlify configuration or its Auto Publishing lock
- Recording a legal approval in `src/content/legal.tsx`
- Opening inquiry intake
- Reading private environment files (`.env.local`, `.env`, `.env.*` except `.env.example`)
- Exposing secret values in code, logs, documents, or chat
- Architecture changes outside the task scope (propose an ADR instead)
- Committing, unless the task authorizes it
- Sending real email or real Turnstile requests from tests or scripts
- Running `integration:identity` or `integration:run` (database work is postponed)

An approval in one task does not carry over to the next.

## Project facts that are easy to get wrong

- Releases are layered. Published = `main@288fde6` (owner-reported); `main` =
  `1797766` (unpublished); `10f09b4`…`4f7f564` are **local only**. Never
  describe a local fix as deployed.
- Authorization is server-side only (`requireUser`, `requireAdmin`,
  `requireSuperAdmin`). Middleware checks only that a cookie is present.
  PostgreSQL row-level security does not exist.
- Build-time environment decisions must use the literal `process.env.NODE_ENV`.
  A value read from a passed `env` object is evaluated at runtime and can fail
  open (DEF-03).
- Inquiry intake opens only through legal approvals; there is no switch.
- Do not add `loading.tsx` to the public route group: it turns draft-project
  404s into soft 404s.
- A full `next build` needs a reachable database. Never point it at production.
- The design is dark-only, with square corners and no shadows. Use the tokens
  in `src/app/globals.css`.
- Use conventional commits, and keep secrets out of `.env.example`.
