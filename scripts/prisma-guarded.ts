/**
 * Entry point for the guarded Prisma commands in package.json:
 *
 *   npm run db:migrate            -> prisma migrate dev     (non-production only)
 *   npm run db:migrate:deploy     -> prisma migrate deploy  (production: --allow-production + typed confirmation)
 *   npm run db:studio             -> prisma studio          (non-production only)
 *
 * See scripts/lib/guarded-prisma.ts and README, "Local database write safety".
 */
import { spawn } from "node:child_process";

import { config as loadEnv } from "dotenv";

import { processIo } from "./lib/database-write-guard";
import { runGuardedPrisma } from "./lib/guarded-prisma";

runGuardedPrisma(process.argv.slice(2), {
  env: process.env,
  io: processIo(),
  loadEnvFiles: (env) => loadEnv({ path: [".env.local", ".env"], processEnv: env as NodeJS.ProcessEnv, quiet: true }),
  spawn: (cliPath, args, env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [cliPath, ...args], { stdio: "inherit", env: env as NodeJS.ProcessEnv });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    }),
  cwd: process.cwd(),
}).then((code) => {
  process.exitCode = code;
});
