/**
 * Offline production-bundle security verification: `npm run test:bundle`.
 *
 * 1. Copies the working tree (tracked and untracked-but-not-ignored files, never
 *    a `.env*` file other than `.env.example`) plus the generated Prisma client
 *    into a fresh temporary directory, and links the repository's node_modules.
 * 2. Runs the real Next.js production compiler there in compile-only mode
 *    (`next build --experimental-build-mode=compile`): no static generation, so
 *    no database. The environment holds system variables only, telemetry is
 *    off, Google Fonts are mocked through Next's own test hook, and the offline
 *    guard is preloaded into every process.
 * 3. Removes the dependency link, then runs the bundle security suite
 *    (`scripts/bundle/security.bundle-test.ts`) and the two real-bundle checks
 *    that `npm test` skips, against that output. Each test process checks its
 *    own isolation first (`assertBundleProcessIsolation`).
 * 4. Fails on any failed, skipped, todo, or cancelled test, on any refused
 *    network attempt, if the build ran without the guard, or if any test
 *    process did not prove the guard active in itself.
 *
 * SIGINT and SIGTERM stop the active child process, remove the dependency
 * link (as a link, never through it), delete the workspace unless `--keep`,
 * and exit 130 or 143. A second signal force-stops the child; cleanup still
 * runs once. Workspaces left by earlier runs are reported, never deleted.
 *
 * Nothing here contacts Neon, Netlify, R2, Sentry, Cloudflare, Resend, or
 * Google, reads `.env.local`, or writes inside the repository. The guard is a
 * Node-level control, not OS-level network isolation (see offline-guard.mjs).
 *
 *   npm run test:bundle            build, verify, and delete the workspace
 *   npm run test:bundle -- --keep  keep the workspace (its path is printed)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MANIFEST_NAME,
  WORKSPACE_PREFIX,
  bundleEnv,
  cleanupWorkspace,
  fontMockModule,
  isCleanRun,
  isLink,
  isPrivateEnvFile,
  listSourceFiles,
  parseGuardLog,
  parseTestSummary,
  removeDependencyLink,
  sourceDigest,
  type BundleManifest,
  type TestSummary,
} from "./workspace";

const REPO = process.cwd();
const NEXT_CLI = join(REPO, "node_modules", "next", "dist", "bin", "next");
const TSX_CLI = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const GUARD = join(REPO, "scripts", "bundle", "offline-guard.mjs");
const BUNDLE_SUITE = "scripts/bundle/security.bundle-test.ts";
/** The two real-bundle checks that skip in `npm test`; here they must run. */
const FORMERLY_SKIPPED = ["src/server/security/rate-limit-production-build.test.ts", "src/server/security/turnstile-production-build.test.ts"];
/** `node --test` runs every file in its own process; each must prove its guard. */
const TEST_FILE_COUNT = 1 + FORMERLY_SKIPPED.length;

type StopSignal = "SIGINT" | "SIGTERM";
const EXIT_STATUS: Record<StopSignal, number> = { SIGINT: 130, SIGTERM: 143 };

/**
 * Local verification hook for the interruption path, read by this process only
 * (children never see it: their environment is rebuilt from system variables).
 * While the build runs it delivers the named signal to this process's own
 * handlers twice, to exercise the handler, the reentrancy guard, and cleanup.
 */
const SELF_TEST_SIGNAL = ((value) => (value === "SIGINT" || value === "SIGTERM" ? value : undefined))(process.env.BUNDLE_RUNNER_SELF_TEST_SIGNAL);

const keep = process.argv.includes("--keep");
/** Child environments are built from scratch; NODE_ENV is deliberately absent. */
const processEnv = (env: Record<string, string>) => env as unknown as NodeJS.ProcessEnv;

function refuse(message: string): never {
  console.error(`\n[test:bundle] REFUSED: ${message}`);
  process.exit(1);
}

/** Inside the workspace section: throws, so the cleanup in `finally` always runs. */
function fail(message: string): never {
  throw new Error(message);
}

class Interrupted extends Error {}

/** Provenance only: a checkout without commits records "none" rather than failing. */
function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "none";
}

async function main(): Promise<void> {
// ------------------------------------------------------------------ preconditions
if (!existsSync(join(REPO, "package.json")) || JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name !== "cinematic-portfolio") {
  refuse("run this from the repository root (npm run test:bundle).");
}
if (!existsSync(NEXT_CLI) || !existsSync(TSX_CLI)) refuse("node_modules is incomplete; install dependencies first.");
if (!existsSync(join(REPO, "src", "generated", "prisma"))) refuse("the generated Prisma client is missing; run npm run db:generate first.");

const nodeMajor = Number(process.versions.node.split(".")[0]);
const expectedMajor = Number(readFileSync(join(REPO, ".node-version"), "utf8").trim().split(".")[0]);
console.log(`[test:bundle] Node.js ${process.version} (project targets ${expectedMajor})`);
if (nodeMajor !== expectedMajor) {
  console.warn(`[test:bundle] WARNING: Node.js ${expectedMajor} verification is PENDING; this run used ${process.version}.`);
}

// ------------------------------------------------------------------ interruption
// Handlers only record the signal and stop the active child. The main flow
// notices at its next await, unwinds through `finally`, and cleans up there:
// one cleanup path, never re-entered.
let interruptedBy: StopSignal | undefined;
let activeChild: ChildProcess | undefined;
const isRunning = (child: ChildProcess | undefined): child is ChildProcess => child !== undefined && child.exitCode === null && child.signalCode === null;

function onStopSignal(signal: StopSignal): void {
  if (interruptedBy) {
    console.error(`[test:bundle] ${signal} received again; already stopping. Force-stopping the active child process.`);
    if (isRunning(activeChild)) activeChild.kill("SIGKILL");
    return;
  }
  interruptedBy = signal;
  console.error(`[test:bundle] ${signal} received; stopping the active child process, then cleaning up.`);
  if (isRunning(activeChild)) activeChild.kill(signal);
}
process.on("SIGINT", onStopSignal);
process.on("SIGTERM", onStopSignal);

// ------------------------------------------------------------------ workspace
const files = listSourceFiles(REPO, existsSync);
if (files.some(isPrivateEnvFile)) refuse("a private environment file was selected for the workspace.");
const digest = sourceDigest(REPO, files);
const temporaryRoot = tmpdir();
const orphans = readdirSync(temporaryRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(WORKSPACE_PREFIX))
  .map((entry) => join(temporaryRoot, entry.name));
if (orphans.length > 0) {
  console.warn("[test:bundle] Workspaces from earlier runs (reported only, not deleted):");
  for (const orphan of orphans) {
    console.warn(`  ${orphan}${isLink(join(orphan, "app", "node_modules")) ? "  (still holds a dependency link: remove the link before deleting)" : ""}`);
  }
}
const workspace = mkdtempSync(join(temporaryRoot, WORKSPACE_PREFIX));
const app = join(workspace, "app");
const nodeModulesLink = join(app, "node_modules");
const guardLog = join(workspace, "offline-guard.log");
const buildLog = join(workspace, "build.log");
const summaries: Array<[string, TestSummary]> = [];
let failed = false;
let cleanupProblems: string[] = [];

async function runChild(args: string[], cwd: string, env: Record<string, string>, live = false): Promise<{ status: number | null; stdout: string; stderr: string }> {
  if (interruptedBy) throw new Interrupted(interruptedBy);
  const child = spawn(process.execPath, args, { cwd, env: processEnv(env), stdio: ["ignore", "pipe", "pipe"] });
  activeChild = child;
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk; if (live) process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk; if (live) process.stderr.write(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    });
  } finally {
    activeChild = undefined;
  }
  if (interruptedBy) throw new Interrupted(interruptedBy);
  return { status: child.exitCode, stdout, stderr };
}

try {
  for (const file of files) {
    const target = join(app, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO, file), target);
  }
  cpSync(join(REPO, "src", "generated"), join(app, "src", "generated"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), nodeModulesLink, process.platform === "win32" ? "junction" : "dir");
  writeFileSync(join(workspace, "font-mock.cjs"), fontMockModule());
  writeFileSync(guardLog, "");
  console.log(`[test:bundle] Workspace: ${workspace} (${files.length} source files, digest ${digest.slice(0, 12)})`);

  const env = bundleEnv(process.env, {
    NODE_OPTIONS: `--import ${pathToFileURL(GUARD).href}`,
    OFFLINE_GUARD_LOG: guardLog,
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: join(workspace, "font-mock.cjs"),
  });

  // ---------------------------------------------------------------- compile-only production build
  console.log("[test:bundle] next build --experimental-build-mode=compile ...");
  if (SELF_TEST_SIGNAL) {
    console.warn(`[test:bundle] SELF-TEST: delivering ${SELF_TEST_SIGNAL} twice to this process during the build.`);
    setTimeout(() => {
      // Back to back, so the second arrives while the first is still being handled.
      process.emit(SELF_TEST_SIGNAL, SELF_TEST_SIGNAL);
      process.emit(SELF_TEST_SIGNAL, SELF_TEST_SIGNAL);
    }, 3000);
  }
  const build = await runChild([NEXT_CLI, "build", "--experimental-build-mode=compile"], app, env);
  writeFileSync(buildLog, `${build.stdout ?? ""}\n${build.stderr ?? ""}`);
  const buildOutput = readFileSync(buildLog, "utf8");
  if (build.status !== 0) fail(`the compile-only build failed (exit ${build.status}); see ${buildLog}.`);
  if (/^\s*- Environments?:/m.test(buildOutput)) fail("Next.js reported loading an environment file during the build.");
  if (!/Build ran with "compile" mode/.test(buildOutput)) fail("the build did not report compile mode.");
  const nextDir = join(app, ".next");
  const buildId = readFileSync(join(nextDir, "BUILD_ID"), "utf8").trim();
  console.log(`[test:bundle] Build ${buildId} compiled.`);

  // The tests resolve externals from the repository, so the link is no longer needed.
  removeDependencyLink(nodeModulesLink);
  if (!existsSync(join(REPO, "node_modules", "next", "package.json"))) fail("the repository's node_modules is no longer intact.");

  const manifest: BundleManifest = {
    buildId,
    sourceDigest: digest,
    sourceFiles: files.length,
    commit: git(["rev-parse", "HEAD"]),
    workingTreeDirty: git(["status", "--porcelain"]).length > 0,
    node: process.version,
    mode: "compile",
  };
  writeFileSync(join(nextDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

  // ---------------------------------------------------------------- suites
  const testEnv = { ...env, PRODUCTION_BUNDLE_DIR: nextDir, BUNDLE_TEST_CONFIGURATION: "fictional-only" };
  const suites: Array<[string, string[]]> = [
    ["bundle security suite", [TSX_CLI, "--test", "--test-reporter=spec", BUNDLE_SUITE]],
    ["formerly skipped real-bundle checks", [TSX_CLI, "--conditions=react-server", "--test", "--test-reporter=spec", ...FORMERLY_SKIPPED]],
  ];
  for (const [name, args] of suites) {
    console.log(`\n[test:bundle] ${name}\n`);
    const run = await runChild(args, REPO, testEnv, true);
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const summary = parseTestSummary(output);
    summaries.push([name, summary]);
    if (run.status !== 0 || !isCleanRun(summary)) failed = true;
  }

  // ---------------------------------------------------------------- network evidence
  const guard = parseGuardLog(readFileSync(guardLog, "utf8"));
  const buildGuarded = guard.installs.some((entry) => /next$/.test(entry.argv1) || entry.argv1.includes("next/dist/bin"));
  const selfTested = new Set(guard.selfTests.map((entry) => entry.pid)).size;
  console.log(`\n[test:bundle] Offline guard: loaded in ${guard.installs.length} processes; ${guard.refusals.length} network attempts refused.`);
  console.log(`[test:bundle] In-process isolation self-test passed in ${selfTested} of ${TEST_FILE_COUNT} test processes.`);
  for (const refusal of guard.refusals) console.log(`  refused ${refusal.kind} to ${refusal.host || "(unknown)"} (pid ${refusal.pid})`);
  if (!buildGuarded) {
    console.log("  the build process did not load the guard");
    failed = true;
  }
  if (selfTested < TEST_FILE_COUNT) {
    console.log("  a test process did not prove the guard active in itself");
    failed = true;
  }
  if (guard.refusals.length > 0) failed = true;
} catch (error) {
  failed = true;
  if (!(error instanceof Interrupted)) {
    console.error("[test:bundle] ERROR", error instanceof Error ? error.message : error);
    if (existsSync(buildLog)) console.error(`[test:bundle] Build log (last 40 lines):\n${readFileSync(buildLog, "utf8").split("\n").slice(-40).join("\n")}`);
  }
} finally {
  cleanupProblems = cleanupWorkspace({ workspace, dependencyLink: nodeModulesLink, temporaryRoot, repoRoot: REPO, keep });
  for (const problem of cleanupProblems) console.error(`[test:bundle] CLEANUP: ${problem}`);
  if (cleanupProblems.length > 0) failed = true;
  if (!existsSync(join(REPO, "node_modules", "next", "package.json"))) {
    console.error("[test:bundle] the repository's node_modules is no longer intact.");
    failed = true;
  }
  if (keep && cleanupProblems.length === 0) console.log(`[test:bundle] Workspace kept (dependency link removed): ${workspace}`);
}

if (interruptedBy) {
  const status = EXIT_STATUS[interruptedBy];
  console.error(`[test:bundle] INTERRUPTED by ${interruptedBy}; dependency link ${isLink(nodeModulesLink) ? "STILL PRESENT" : "removed"}; workspace ${existsSync(workspace) ? `left at ${workspace}` : "deleted"}. Exiting ${status}.`);
  process.exit(status);
}

console.log("\n[test:bundle] Summary");
for (const [name, s] of summaries) {
  console.log(`  ${isCleanRun(s) ? "PASS" : "FAIL"}  ${name}: ${s.tests} tests, ${s.pass} passed, ${s.fail} failed, ${s.skipped} skipped, ${s.todo} todo, ${s.cancelled} cancelled`);
}
if (nodeMajor !== expectedMajor) console.log(`  PENDING  Node.js ${expectedMajor} verification (ran on ${process.version})`);
console.log(failed || summaries.length !== 2 ? "\n[test:bundle] FAILED" : "\n[test:bundle] PASSED");
process.exit(failed || summaries.length !== 2 ? 1 : 0);
}

void main().catch((error) => {
  console.error("[test:bundle] FATAL", error instanceof Error ? error.message : error);
  process.exit(1);
});
