/**
 * Side-effect import for write-capable verification scripts.
 *
 * It must be the script's first import: modules are evaluated in import order,
 * so a refusal here exits before the Prisma client (or anything else that can
 * reach the database) is even loaded. It imports nothing that touches a
 * database. Verification scripts never accept `--allow-production`.
 */
import { basename } from "node:path";

import { enforceNonProduction, processIo } from "./database-write-guard";

enforceNonProduction(
  {
    operation: basename(process.argv[1] ?? "verification script").replace(/\.[cm]?[jt]s$/, ""),
    env: process.env,
    argv: process.argv.slice(2),
  },
  processIo(),
);
