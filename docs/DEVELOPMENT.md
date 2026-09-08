# Development Guide

## Phase workflow

Each phase follows the same gated workflow:

1. Inspect Git state and all relevant existing code/documentation.
2. State the intended changes and remain inside the approved phase scope.
3. Implement the smallest complete set of phase requirements.
4. Run proportionate lint, type, test, build, and security checks that exist at
   that point in the project.
5. Fix discovered errors and review the complete diff for accidental changes or
   secrets.
6. Report files changed, validation results, configuration needs, and the proposed
   commit.
7. Stop and wait for explicit approval before starting the next phase.

Do not silently pull work forward from a later phase.

## Branch and commit conventions

- `main` is the current base branch. Inspect it before editing.
- Do not reinitialize Git, replace history, force-push, or delete branches without
  explicit permission.
- Do not push to a remote without explicit permission.
- Keep commits focused and use conventional prefixes such as `chore:`, `feat:`,
  `fix:`, `refactor:`, `docs:`, and `test:`.
- Before proposing a commit, inspect `git status` and `git diff`, run applicable
  validation, and scan for credentials.
- Preserve unrelated work already present in the working tree.

## Environment and secrets

- `.env.example` is the committed environment contract and contains names with
  empty values only.
- Use `.env.local` for local credentials once a phase requires them.
- Configure production secrets in the deployment platform.
- Never commit API keys, passwords, connection strings, private keys, session
  secrets, tokens, or real customer data.
- Only variables intentionally safe for browser exposure may use the
  `NEXT_PUBLIC_` prefix.
- Server-only configuration must not be imported by Client Components.
- Add external service accounts only in the phase that integrates that service.

## Coding principles

- Use strict TypeScript and do not introduce `any` as an escape hatch.
- Prefer Server Components and add Client Components only for required browser
  interaction.
- Keep components and modules focused; separate UI, validation, business rules,
  and data access without premature abstractions.
- Reuse existing platform capabilities before adding dependencies.
- Validate every untrusted input at the server boundary and return safe errors.
- Enforce authentication, authorization, and roles on the server.
- Centralize design tokens instead of scattering arbitrary visual values.
- Build semantic, keyboard-accessible, responsive interfaces and respect
  `prefers-reduced-motion`.
- Design toward WCAG 2.2 AA and privacy-conscious EU operation.
- Keep content structures ready for future German localization without building
  full internationalization prematurely.

## Validation expectations

Validation grows with the implementation. Once corresponding tooling exists, each
change should run the relevant subset of:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Live flows that only exist against a database, R2, or HTTP have their own
verification scripts, each of which cleans up after itself:

```powershell
npm run auth:verify     # route protection and sessions (needs a running app)
npm run media:verify    # upload, variants, and deletion against R2
npm run cms:verify      # admin CRUD, publishing, and reference protection
npm run public:verify   # public rendering; see the README for its three steps
```

Business-critical behavior receives priority over high-volume, low-value tests.
Expected coverage eventually includes authentication and authorization, inquiry
validation, admin CRUD, accessibility, and critical public/admin E2E flows.

Before every commit:

```powershell
git status
git diff --check
git diff
```

Also inspect staged changes with `git diff --cached` if files have been staged.

## Architecture and agent coordination

- The approved architecture is documented in `docs/ARCHITECTURE.md` and ADRs in
  `docs/DECISIONS/`.
- Document meaningful new architectural decisions using sequential ADR files.
- Do not make undocumented architectural changes, including changes proposed by
  an automated assistant.
- If an approved choice appears unsuitable, stop and document the existing
  decision, proposed change, reasons, benefits, drawbacks, and migration impact;
  then wait for approval.
- Multiple contributors or assistants must inspect current repository state and
  preserve each other's unrelated work.

## Dependency policy

Before adding a package, check whether Next.js, React, the language, or an existing
dependency solves the problem cleanly. Add only maintained packages that serve a
clear requirement in the current phase. The free-first infrastructure policy is
binding: paid infrastructure requires a demonstrated technical need and explicit
approval.
