/**
 * Helpers for the offline production-bundle verification
 * (`npm run test:bundle`, see `scripts/bundle/run.ts`).
 *
 * The safety rules live here so they are unit-tested in `npm test`: which files
 * may enter the build workspace, which environment the build sees, what counts
 * as a clean test run, whether a bundle-test process is isolated, and how the
 * workspace and its dependency link are removed. Only the cleanup helpers at the
 * end write to the file system, and only inside a validated temporary workspace.
 */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { buildChildEnv } from "../integration/identity";

/** Every workspace the runner creates is a direct child of the temporary directory with this prefix. */
export const WORKSPACE_PREFIX = "munir-bundle-";

/** The host the bundle suite probes to prove the offline guard blocks. Reserved, never resolvable. */
export const GUARD_SELF_TEST_HOST = "offline-guard-self-test.invalid";

/** The manifest the runner writes next to the build, and the bundle tests check. */
export const MANIFEST_NAME = "bundle-verification.json";

/** The marker `offline-guard.mjs` defines, non-writable, before it hooks anything. */
const GUARD_MARKER = Symbol.for("munir.bundle.offlineGuard");

/**
 * Names of variables that hold, or point at, production credentials or
 * services. None may reach a bundle-test process: the runner passes system
 * variables only, and each test sets its own fictional values afterwards.
 */
const SENSITIVE_ENV_NAME =
  /SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|DATABASE_URL|POSTGRES|DSN|^PG|^NEON_|^NETLIFY_|^R2_|^AWS_|^RESEND_|^SENTRY_|^TURNSTILE_|^BETTER_AUTH_|^RATE_LIMIT_|^ADMIN_BOOTSTRAP|^EMAIL_|^UMAMI_|_ENDPOINT$/i;

/**
 * Environment problems for a bundle-test process, by variable **name** only:
 * a message never contains a value.
 */
export function environmentIsolationProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const name of Object.keys(env).sort()) {
    if (env[name] !== undefined && SENSITIVE_ENV_NAME.test(name)) problems.push(`${name} must be absent when a bundle-test process starts`);
  }
  if (env.BUNDLE_TEST_CONFIGURATION !== "fictional-only") problems.push("BUNDLE_TEST_CONFIGURATION must be fictional-only");
  if (!/offline-guard\.mjs/.test(env.NODE_OPTIONS ?? "")) problems.push("NODE_OPTIONS must preload the offline guard");
  return problems;
}

/**
 * Whether the offline guard is active in this very process: its marker is set,
 * `fetch`, `WebSocket`, and `net.Socket#connect` are its hooks, and a TCP
 * connection to a reserved `.invalid` host is refused synchronously, before any
 * DNS lookup. Nothing is probed unless the guard's hook is installed, so the
 * probe cannot leave the process. The refusal is logged with GUARD_SELF_TEST_HOST,
 * which the runner counts as a self-test rather than a network attempt.
 */
export function guardIsolationProblems(): string[] {
  const globals = globalThis as unknown as Record<string | symbol, unknown>;
  if (globals[GUARD_MARKER] !== true) return ["the Node offline guard is not loaded in this process"];
  const problems: string[] = [];
  if (typeof globalThis.fetch === "function" && globalThis.fetch.name !== "offlineGuardedFetch") problems.push("fetch is not the offline guard's hook");
  if (typeof globals.WebSocket === "function" && (globals.WebSocket as { name: string }).name !== "OfflineGuardedWebSocket") {
    problems.push("WebSocket is not the offline guard's hook");
  }
  if (net.Socket.prototype.connect.name !== "offlineGuardedConnect") return [...problems, "net.Socket#connect is not the offline guard's hook"];
  const socket = new net.Socket();
  socket.on("error", () => {});
  try {
    socket.connect({ host: GUARD_SELF_TEST_HOST, port: 9 });
    problems.push("the offline guard did not refuse a TCP connection");
  } catch (error) {
    if (!/^Offline guard refused/.test(error instanceof Error ? error.message : "")) problems.push("the TCP probe failed for a reason other than the offline guard");
  } finally {
    socket.destroy();
  }
  return problems;
}

/**
 * Fails inside each bundle-test process unless the runner supplied an isolated,
 * guarded environment. Called at module load, before a test sets any value, so a
 * violation fails the whole file and therefore the run. Messages name variables
 * and hooks, never values.
 *
 * This proves only what Node.js sees. The guard hooks `fetch`, `WebSocket`, and
 * `net`; it is not OS-level network isolation (see `offline-guard.mjs`).
 */
export function assertBundleProcessIsolation(): void {
  const problems = [...guardIsolationProblems(), ...environmentIsolationProblems(process.env)];
  assert.deepEqual(problems, [], `bundle-test process isolation failed:\n- ${problems.join("\n- ")}`);
}

export type BundleManifest = {
  buildId: string;
  sourceDigest: string;
  sourceFiles: number;
  commit: string;
  workingTreeDirty: boolean;
  node: string;
  mode: "compile";
};

/**
 * True for any `.env*` file other than `.env.example`, in any directory.
 * Next.js loads `.env*` files from the project directory on its own, so none
 * may enter the build workspace.
 */
export function isPrivateEnvFile(relativePath: string): boolean {
  const name = relativePath.split(/[\\/]/).pop() ?? "";
  return /^\.env/i.test(name) && name.toLowerCase() !== ".env.example";
}

/** Paths that never belong in the workspace, whatever git reports. */
function isExcluded(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return (
    isPrivateEnvFile(normalized) ||
    normalized.startsWith(".next/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith("src/generated/")
  );
}

/** Filters a file list down to what the build workspace may hold, sorted for a stable digest. */
export function selectWorkspaceFiles(listed: readonly string[]): string[] {
  return [...new Set(listed.filter((file) => file.length > 0 && !isExcluded(file)))].sort();
}

/**
 * Tracked and untracked-but-not-ignored files of the working tree, so the
 * build reflects uncommitted edits too. Ignored files (`.env.local`,
 * `node_modules`, `.next`) are never listed by git, and are filtered again here.
 */
export function listSourceFiles(repoRoot: string, exists: (path: string) => boolean): string[] {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return selectWorkspaceFiles(result.stdout.split("\0")).filter((file) => exists(join(repoRoot, file)));
}

/** SHA-256 over every selected file's path and bytes, so a bundle can be tied to the exact source it was built from. */
export function sourceDigest(repoRoot: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(readFileSync(join(repoRoot, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * The module Next.js reads through NEXT_FONT_GOOGLE_MOCKED_RESPONSES (its own
 * test hook) instead of fetching Google Fonts. Every stylesheet URL gets a
 * local `@font-face`; the font file URL is never fetched, because in mocked
 * mode Next.js uses the URL string itself as the font bytes.
 */
export function fontMockModule(): string {
  return [
    "// Generated by scripts/bundle/run.ts: offline stand-in for Google Fonts stylesheets.",
    "const css = (family) => `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.offline.invalid/mock.woff2) format('woff2');unicode-range:U+0000-00FF;}`;",
    "module.exports = new Proxy({}, { get: (_target, url) => {",
    "  const match = /family=([^:&]+)/.exec(String(url));",
    "  return css(match ? decodeURIComponent(match[1]).replace(/\\+/g, ' ') : 'Mock');",
    "} });",
    "",
  ].join("\n");
}

/**
 * The environment every verification process receives: system variables only
 * (no secrets, no database URL, no inherited NODE_OPTIONS), plus the values
 * given. Fictional application values are set by the tests themselves.
 */
export function bundleEnv(parent: Record<string, string | undefined>, values: Record<string, string>): Record<string, string> {
  return buildChildEnv(parent, { NEXT_TELEMETRY_DISABLED: "1", ...values });
}

export type TestSummary = { tests: number; pass: number; fail: number; skipped: number; todo: number; cancelled: number };

/** Reads the totals `node --test --test-reporter=spec` prints. Missing totals count as a failure. */
export function parseTestSummary(output: string): TestSummary {
  const count = (name: keyof TestSummary) => {
    const match = new RegExp(`^ℹ ${name} (\\d+)\\r?$`, "m").exec(output);
    return match ? Number(match[1]) : Number.NaN;
  };
  return { tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"), todo: count("todo"), cancelled: count("cancelled") };
}

/** A required-security run passes only if tests ran and none failed, skipped, was cancelled, or was left todo. */
export function isCleanRun(summary: TestSummary): boolean {
  return summary.tests > 0 && summary.pass === summary.tests && summary.fail === 0 && summary.skipped === 0 && summary.todo === 0 && summary.cancelled === 0;
}

export type GuardLog = {
  installs: Array<{ pid: number; argv1: string }>;
  /** Real network attempts the guard refused. Any one fails the run. */
  refusals: Array<{ pid: number; kind: string; host: string }>;
  /** Refusals of GUARD_SELF_TEST_HOST: the in-process probe of `guardIsolationProblems`. */
  selfTests: Array<{ pid: number; kind: string }>;
};

/** Parses the offline guard's JSON-lines log. */
export function parseGuardLog(text: string): GuardLog {
  const log: GuardLog = { installs: [], refusals: [], selfTests: [] };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { pid: number; kind: string; host?: string; argv1?: string };
    if (entry.kind === "guard-installed") log.installs.push({ pid: entry.pid, argv1: entry.argv1 ?? "" });
    else if (entry.host === GUARD_SELF_TEST_HOST) log.selfTests.push({ pid: entry.pid, kind: entry.kind });
    else log.refusals.push({ pid: entry.pid, kind: entry.kind, host: entry.host ?? "" });
  }
  return log;
}

// ------------------------------------------------------------------ workspace cleanup

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** True for a symlink or, on Windows, a directory junction (Node's lstat reports both as links). */
export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * Removes the workspace's dependency junction or symlink itself, never its
 * target. A missing path is fine (partial initialization); anything that is
 * not a link is refused rather than deleted.
 */
export function removeDependencyLink(path: string): void {
  if (!pathExists(path)) return;
  if (!isLink(path)) throw new Error(`refusing to remove a dependency path that is not a link: ${path}`);
  try {
    unlinkSync(path);
  } catch {
    rmdirSync(path); // a Windows junction: removes the junction entry only, never recursive
  }
  if (pathExists(path)) throw new Error(`the dependency link is still present: ${path}`);
}

/** Every symlink or junction under `root`, found with lstat and never followed. */
export function findLinks(root: string): string[] {
  if (!pathExists(root)) return [];
  if (isLink(root)) return [root];
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) found.push(path);
      else if (stat.isDirectory()) pending.push(path);
    }
  }
  return found;
}

/** Why `workspace` may not be removed, or null: it must be a fresh `munir-bundle-*` child of the temporary directory, unrelated to the repository. */
export function workspaceRemovalProblem(workspace: string, temporaryRoot: string, repoRoot: string): string | null {
  const path = resolve(workspace);
  const name = basename(path);
  if (dirname(path) !== resolve(temporaryRoot) || !name.startsWith(WORKSPACE_PREFIX) || name.length === WORKSPACE_PREFIX.length) {
    return `not a bundle workspace in the temporary directory: ${path}`;
  }
  if (isInside(path, repoRoot) || isInside(repoRoot, path)) return `the workspace overlaps the repository: ${path}`;
  if (isLink(path)) return `the workspace path is itself a link: ${path}`;
  return null;
}

export type WorkspaceCleanup = { workspace: string; dependencyLink: string; temporaryRoot: string; repoRoot: string; keep: boolean };

/**
 * Removes the dependency link, then (unless `keep`) the workspace. Returns the
 * problems found; an empty list means everything requested was removed.
 *
 * Safe by construction: nothing outside a validated workspace is touched; the
 * link is removed as a link, and the recursive delete runs only after a no-follow
 * scan finds no link anywhere in the workspace, so it can never reach the
 * repository or its node_modules. Calling it again is harmless.
 */
export function cleanupWorkspace({ workspace, dependencyLink, temporaryRoot, repoRoot, keep }: WorkspaceCleanup): string[] {
  const invalid = workspaceRemovalProblem(workspace, temporaryRoot, repoRoot);
  if (invalid) return [invalid];
  if (!isInside(dependencyLink, workspace) || resolve(dependencyLink) === resolve(workspace)) {
    return [`the dependency link is not inside the workspace: ${dependencyLink}`];
  }
  try {
    removeDependencyLink(dependencyLink);
  } catch (error) {
    return [`${error instanceof Error ? error.message : String(error)}; workspace left at ${workspace}`];
  }
  if (keep) return [];
  const links = findLinks(workspace);
  if (links.length > 0) return [`workspace not deleted because it holds links (${links.join(", ")}); left at ${workspace}`];
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch (error) {
    return [`could not delete the workspace (${error instanceof Error ? error.message : String(error)}); left at ${workspace}`];
  }
  return [];
}
