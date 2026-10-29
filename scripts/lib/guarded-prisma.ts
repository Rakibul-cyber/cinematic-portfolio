import { existsSync } from "node:fs";
import { join } from "node:path";

import { ALLOW_PRODUCTION_FLAG, enforceNonProduction, enforceWithProductionConfirmation, type GuardEnv, type GuardIo } from "./database-write-guard";

/**
 * Database-writing Prisma CLI commands, behind the write guard.
 *
 * `prisma.config.ts` loads `.env.local` then `.env` without overriding values
 * already in the shell, and migrates through `DATABASE_URL_UNPOOLED ??
 * DATABASE_URL`. The same files are loaded the same way here *before* the
 * guard decides, so the guard judges exactly the target the CLI would use; the
 * child inherits that environment unchanged. Read-only and offline commands
 * (`migrate status`, `generate`) are not wrapped.
 */
export const GUARDED_PRISMA_COMMANDS = {
  "migrate-dev": { operation: "db:migrate", args: ["migrate", "dev"], productionCapable: false },
  "migrate-deploy": { operation: "db:migrate:deploy", args: ["migrate", "deploy"], productionCapable: true },
  studio: { operation: "db:studio", args: ["studio"], productionCapable: false },
} as const;

export type SpawnPrisma = (cliPath: string, args: string[], env: GuardEnv) => Promise<number>;

export type GuardedPrismaDeps = {
  env: GuardEnv;
  io: GuardIo;
  /** Loads `.env.local` and `.env` into `env` without overriding (dotenv semantics). */
  loadEnvFiles: (env: GuardEnv) => void;
  spawn: SpawnPrisma;
  cwd: string;
};

/** Returns the exit code; never spawns Prisma unless the guard allowed it. */
export async function runGuardedPrisma(argv: readonly string[], deps: GuardedPrismaDeps): Promise<number> {
  const [name, ...rest] = argv;
  const command = GUARDED_PRISMA_COMMANDS[name as keyof typeof GUARDED_PRISMA_COMMANDS];
  if (!command) {
    deps.io.error(`[db-guard] Unknown command. Use one of: ${Object.keys(GUARDED_PRISMA_COMMANDS).join(", ")}.`);
    return 1;
  }

  deps.loadEnvFiles(deps.env);
  const request = { operation: command.operation, env: deps.env, argv: rest };
  if (command.productionCapable) await enforceWithProductionConfirmation(request, deps.io);
  else enforceNonProduction(request, deps.io);

  const cliPath = join(deps.cwd, "node_modules", "prisma", "build", "index.js");
  if (!existsSync(cliPath)) {
    deps.io.error("[db-guard] The Prisma CLI is not installed. Run npm install first.");
    return 1;
  }
  return deps.spawn(cliPath, [...command.args, ...rest.filter((argument) => argument !== ALLOW_PRODUCTION_FLAG)], deps.env);
}
