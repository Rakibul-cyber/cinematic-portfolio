/**
 * Side-effect gate for `video.integration.ts`. It must be that file's first
 * import: modules are evaluated in import order, so a refusal here exits before
 * the Prisma client or the Neon driver is even loaded, and no connection can be
 * attempted. It imports nothing that can reach a database.
 */
import { assessVideoSuiteEnv } from "./video-target";

const checked = assessVideoSuiteEnv(process.env);
if (!checked.ok) {
  console.error("\n[video-integration] Refused. No connection was opened and nothing was changed.");
  for (const reason of checked.reasons) console.error(`  - ${reason}`);
  process.exit(1);
}

export const videoSuiteTarget = checked.value;
