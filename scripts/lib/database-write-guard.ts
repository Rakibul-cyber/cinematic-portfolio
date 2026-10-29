/**
 * Write-safety guard for local database tooling.
 *
 * The verification scripts, the first-administrator bootstrap, and the Prisma
 * migration/studio commands all write to whatever database `.env.local` names.
 * Before any of them connects, this module decides whether that target is an
 * approved non-production database, and refuses otherwise.
 *
 * Why a label is not enough: a Neon connection string names a compute
 * *endpoint* (`ep-…`), not a branch, so nothing in the URL proves which branch
 * it reaches, and `NEON_BRANCH` is an informational label anyone can edit.
 * The guard therefore requires the operator to declare the approved endpoint
 * (`DEV_DATABASE_ENDPOINT`) and checks that every connection URL actually
 * points at it. Production work additionally requires the production endpoint
 * to be declared (`PRODUCTION_DATABASE_ENDPOINT`), an explicit
 * `--allow-production` flag that only two operations accept, and a typed
 * confirmation at an interactive terminal.
 *
 * Messages name variables, never values: no connection string, user name,
 * password, or host is ever printed by a refusal.
 */

export const ALLOW_PRODUCTION_FLAG = "--allow-production";

/** Branch labels treated as production. Neon's default branch is often `main`. */
const PRODUCTION_BRANCH_LABELS = new Set(["production", "prod", "main", "master"]);

/** Operations that may, with explicit authorization, run against production. */
export const PRODUCTION_CAPABLE_OPERATIONS = ["admin:bootstrap", "db:migrate:deploy"] as const;
export type ProductionCapableOperation = (typeof PRODUCTION_CAPABLE_OPERATIONS)[number];

export type GuardEnv = Record<string, string | undefined>;

type Identity = { ok: true; identity: string } | { ok: false; reason: string };

/**
 * The database target a connection URL reaches: the Neon endpoint id for a
 * Neon host (pooled and direct hosts share it), otherwise the host name.
 * Anything that could redirect the connection elsewhere is ambiguous.
 */
export function targetIdentity(name: string, value: string | undefined): Identity {
  if (!value || value.trim() === "") return { ok: false, reason: `${name} is not set.` };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: `${name} is not a valid connection URL.` };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { ok: false, reason: `${name} is not a PostgreSQL connection URL.` };
  }
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(",")) {
    return { ok: false, reason: `${name} does not name exactly one database host.` };
  }
  // libpq lets query parameters override the host, and Neon accepts the
  // endpoint through `options`; either makes the host an unreliable identity.
  for (const parameter of ["host", "hostaddr"]) {
    if (url.searchParams.has(parameter)) {
      return { ok: false, reason: `${name} overrides its host with a "${parameter}" parameter, so its target is ambiguous.` };
    }
  }
  if (/endpoint/i.test(url.searchParams.get("options") ?? "")) {
    return { ok: false, reason: `${name} selects an endpoint through "options", so its target is ambiguous.` };
  }
  if (host.endsWith(".neon.tech")) {
    const endpoint = host.split(".")[0].replace(/-pooler$/, "");
    if (!/^ep-[a-z0-9-]+$/.test(endpoint)) {
      return { ok: false, reason: `${name} is a Neon host without a recognisable endpoint id.` };
    }
    return { ok: true, identity: endpoint };
  }
  return { ok: true, identity: host };
}

const declared = (value: string | undefined) => value?.trim().toLowerCase() || null;

export type TargetAssessment =
  | { kind: "approved-non-production"; identity: string }
  | { kind: "declared-production"; identity: string; branchLabel: string | null }
  | { kind: "refused"; reasons: string[] };

/**
 * Classifies the effective database target. Exactly the URLs the tools use are
 * checked: `DATABASE_URL` (application client) and, when set,
 * `DATABASE_URL_UNPOOLED` (Prisma Migrate). They must agree.
 */
export function assessTarget(env: GuardEnv): TargetAssessment {
  const reasons: string[] = [];
  const pooled = targetIdentity("DATABASE_URL", env.DATABASE_URL);
  const direct = env.DATABASE_URL_UNPOOLED === undefined ? null : targetIdentity("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED);
  if (!pooled.ok) reasons.push(pooled.reason);
  if (direct && !direct.ok) reasons.push(direct.reason);
  if (pooled.ok && direct?.ok && pooled.identity !== direct.identity) {
    reasons.push("DATABASE_URL and DATABASE_URL_UNPOOLED point at different databases.");
  }

  const dev = declared(env.DEV_DATABASE_ENDPOINT);
  const production = declared(env.PRODUCTION_DATABASE_ENDPOINT);
  if (dev && production && dev === production) {
    reasons.push("DEV_DATABASE_ENDPOINT and PRODUCTION_DATABASE_ENDPOINT name the same database.");
  }
  if (reasons.length || !pooled.ok) return { kind: "refused", reasons };

  const identity = pooled.identity;
  const branch = env.NEON_BRANCH?.trim() || null;
  const branchIsProduction = branch !== null && PRODUCTION_BRANCH_LABELS.has(branch.toLowerCase());

  if (production && identity === production) {
    if (branch !== null && !branchIsProduction) {
      return { kind: "refused", reasons: ["NEON_BRANCH names a non-production branch, but the connection URLs point at PRODUCTION_DATABASE_ENDPOINT."] };
    }
    return { kind: "declared-production", identity, branchLabel: branch };
  }

  if (branch === null) reasons.push("NEON_BRANCH is not set.");
  else if (branchIsProduction) reasons.push(`NEON_BRANCH is a production branch label (${[...PRODUCTION_BRANCH_LABELS].join(", ")}).`);
  if (!dev) reasons.push("DEV_DATABASE_ENDPOINT is not set, so the target cannot be confirmed as an approved non-production database.");
  else if (identity !== dev) reasons.push("The connection URLs do not point at DEV_DATABASE_ENDPOINT.");
  if (reasons.length) return { kind: "refused", reasons };
  return { kind: "approved-non-production", identity };
}

export type GuardRequest = {
  /** Name shown in messages, e.g. `verify-cms-flow` or `db:migrate`. */
  operation: string;
  env: GuardEnv;
  argv: readonly string[];
};

export type GuardDecision =
  | { action: "proceed" }
  | { action: "confirm-production"; identity: string; branchLabel: string | null }
  | { action: "refuse"; reasons: string[] };

const isProductionCapable = (operation: string): operation is ProductionCapableOperation =>
  (PRODUCTION_CAPABLE_OPERATIONS as readonly string[]).includes(operation);

/** The pure decision: proceed, ask for production confirmation, or refuse. */
export function decide({ operation, env, argv }: GuardRequest): GuardDecision {
  const flagged = argv.includes(ALLOW_PRODUCTION_FLAG);
  if (flagged && !isProductionCapable(operation)) {
    return { action: "refuse", reasons: [`${ALLOW_PRODUCTION_FLAG} is not accepted by ${operation}; only ${PRODUCTION_CAPABLE_OPERATIONS.join(" and ")} may run against production.`] };
  }
  const target = assessTarget(env);
  if (target.kind === "refused") return { action: "refuse", reasons: target.reasons };
  if (target.kind === "approved-non-production") {
    return flagged
      ? { action: "refuse", reasons: [`${ALLOW_PRODUCTION_FLAG} was given, but the target is the approved non-production database. Remove the flag.`] }
      : { action: "proceed" };
  }
  if (!isProductionCapable(operation)) {
    return { action: "refuse", reasons: [`The connection URLs point at PRODUCTION_DATABASE_ENDPOINT; ${operation} never runs against production.`] };
  }
  if (!flagged) {
    return { action: "refuse", reasons: [`The connection URLs point at PRODUCTION_DATABASE_ENDPOINT. Production ${operation} requires ${ALLOW_PRODUCTION_FLAG} and an interactive confirmation.`] };
  }
  return { action: "confirm-production", identity: target.identity, branchLabel: target.branchLabel };
}

export function refusalMessage(operation: string, reasons: readonly string[]): string {
  return [
    `[db-guard] Refusing to run ${operation}: the database target is not an approved non-production database.`,
    ...reasons.map((reason) => `  - ${reason}`),
    "  Nothing was connected to. See README, \"Local database write safety\".",
  ].join("\n");
}

export type GuardIo = {
  exit: (code: number) => never;
  error: (message: string) => void;
  log: (message: string) => void;
  /** Whether stdin and stdout are both an interactive terminal. */
  interactive: boolean;
  /** Asks one question and resolves with the typed line. */
  ask: (prompt: string) => Promise<string>;
};

/**
 * Synchronous enforcement for tools that never run against production. Safe to
 * call from a side-effect import placed before any database import.
 */
export function enforceNonProduction(request: GuardRequest, io: Pick<GuardIo, "exit" | "error">): void {
  const decision = decide(request);
  if (decision.action === "proceed") return;
  const reasons = decision.action === "refuse" ? decision.reasons : [`${request.operation} never runs against production.`];
  io.error(refusalMessage(request.operation, reasons));
  io.exit(1);
}

/**
 * Enforcement for the two production-capable operations. Resolves only when
 * the caller may connect: an approved non-production target, or a declared
 * production target confirmed by typing its endpoint id at a terminal.
 */
export async function enforceWithProductionConfirmation(request: GuardRequest, io: GuardIo): Promise<void> {
  const decision = decide(request);
  if (decision.action === "proceed") return;
  if (decision.action === "refuse") {
    io.error(refusalMessage(request.operation, decision.reasons));
    io.exit(1);
  }
  if (!io.interactive) {
    io.error(refusalMessage(request.operation, ["Production operations require an interactive terminal for confirmation; none is attached."]));
    io.exit(1);
  }
  io.log(
    `\n  PRODUCTION ${request.operation}` +
      `\n  Target endpoint: ${decision.identity}${decision.branchLabel ? ` (NEON_BRANCH=${decision.branchLabel})` : ""}` +
      "\n  This writes to the production database.\n",
  );
  const answer = (await io.ask(`  Type the target endpoint id to continue: `)).trim().toLowerCase();
  if (answer !== decision.identity) {
    io.error(refusalMessage(request.operation, ["The confirmation did not match the target endpoint id."]));
    io.exit(1);
  }
}

/** Real process wiring for the CLI entry points. */
export function processIo(): GuardIo {
  return {
    exit: (code) => process.exit(code),
    error: (message) => console.error(message),
    log: (message) => console.log(message),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async ask(prompt) {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(prompt);
      } finally {
        rl.close();
      }
    },
  };
}
