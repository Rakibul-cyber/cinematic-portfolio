import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

import {
  GUARD_SELF_TEST_HOST,
  WORKSPACE_PREFIX,
  bundleEnv,
  cleanupWorkspace,
  environmentIsolationProblems,
  findLinks,
  fontMockModule,
  guardIsolationProblems,
  isCleanRun,
  isLink,
  isPrivateEnvFile,
  parseGuardLog,
  parseTestSummary,
  removeDependencyLink,
  selectWorkspaceFiles,
  workspaceRemovalProblem,
} from "./workspace";

/**
 * The safety rules of `npm run test:bundle` that need no build: what may enter
 * the build workspace, what environment the build sees, and when a run counts
 * as clean. The bundle suite itself runs only through `npm run test:bundle`.
 */

describe("the bundle workspace file selection", () => {
  it("never admits a private environment file, in any directory or case", () => {
    for (const file of [".env", ".env.local", ".env.production", ".ENV.LOCAL", "config/.env.test", "scripts\\.env.development.local"]) {
      assert.equal(isPrivateEnvFile(file), true, file);
    }
    assert.equal(isPrivateEnvFile(".env.example"), false);
    assert.equal(isPrivateEnvFile("src/server/env.ts"), false);
  });

  it("drops environment files, build output, dependencies, and the generated client", () => {
    const selected = selectWorkspaceFiles([
      "package.json",
      ".env.local",
      ".env.example",
      ".next/BUILD_ID",
      "node_modules/next/package.json",
      "packages/x/node_modules/y.js",
      "src/generated/prisma/client.ts",
      "src/app/layout.tsx",
      "",
      "package.json",
    ]);
    assert.deepEqual(selected, [".env.example", "package.json", "src/app/layout.tsx"]);
  });
});

describe("the bundle build environment", () => {
  it("passes system variables only, never secrets, database URLs, or inherited NODE_OPTIONS", () => {
    const env = bundleEnv(
      {
        PATH: "/bin",
        SystemRoot: "C:\\Windows",
        DATABASE_URL: "postgresql://fictional:fictional@db.example.invalid/x",
        RATE_LIMIT_HMAC_SECRET: "fictional",
        BETTER_AUTH_SECRET: "fictional",
        NEXT_PUBLIC_SENTRY_DSN: "https://k@o0.ingest.sentry.example.invalid/1",
        NODE_OPTIONS: "--require ./elsewhere.js",
        NODE_ENV: "development",
      },
      { NODE_OPTIONS: "--import guard" },
    );
    assert.deepEqual(env, { PATH: "/bin", SystemRoot: "C:\\Windows", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--import guard" });
  });

  it("mocks Google Fonts stylesheets without any fetchable font host", () => {
    const loaded = { exports: {} as Record<string, string> };
    new Function("module", fontMockModule())(loaded);
    const css = loaded.exports["https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400&display=swap"];
    assert.match(css, /font-family:'Cormorant Garamond'/);
    assert.match(css, /\.invalid\//);
  });
});

describe("the bundle run verdict", () => {
  const output = (counts: Record<string, number>) => Object.entries(counts).map(([name, value]) => `ℹ ${name} ${value}`).join("\n");

  it("is clean only when every test ran and passed", () => {
    const clean = parseTestSummary(output({ tests: 5, pass: 5, fail: 0, skipped: 0, todo: 0, cancelled: 0 }));
    assert.equal(isCleanRun(clean), true);
    assert.equal(isCleanRun(parseTestSummary(output({ tests: 5, pass: 4, fail: 0, skipped: 1, todo: 0, cancelled: 0 }))), false, "a skip fails");
    assert.equal(isCleanRun(parseTestSummary(output({ tests: 5, pass: 4, fail: 1, skipped: 0, todo: 0, cancelled: 0 }))), false);
    assert.equal(isCleanRun(parseTestSummary(output({ tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 }))), false, "no tests fails");
    assert.equal(isCleanRun(parseTestSummary("no summary at all")), false);
    const crlf = output({ tests: 2, pass: 2, fail: 0, skipped: 0, todo: 0, cancelled: 0 }).replace(/\n/g, "\r\n");
    assert.equal(isCleanRun(parseTestSummary(crlf)), true, "Windows line endings");
  });

  it("separates guard installs from refused network attempts", () => {
    const log = parseGuardLog(
      [
        JSON.stringify({ pid: 1, kind: "guard-installed", argv1: "dist/bin/next" }),
        JSON.stringify({ pid: 2, kind: "fetch", host: "fonts.googleapis.com" }),
        "",
      ].join("\n"),
    );
    assert.deepEqual(log.installs, [{ pid: 1, argv1: "dist/bin/next" }]);
    assert.deepEqual(log.refusals, [{ pid: 2, kind: "fetch", host: "fonts.googleapis.com" }]);
  });

  it("counts the in-process guard probe as a self-test, never as a tolerated network attempt", () => {
    const log = parseGuardLog(
      [
        JSON.stringify({ pid: 3, kind: "tcp", host: GUARD_SELF_TEST_HOST }),
        JSON.stringify({ pid: 3, kind: "tcp", host: "db.example.invalid" }),
      ].join("\n"),
    );
    assert.deepEqual(log.selfTests, [{ pid: 3, kind: "tcp" }]);
    assert.deepEqual(log.refusals, [{ pid: 3, kind: "tcp", host: "db.example.invalid" }]);
  });
});

describe("the bundle-test process isolation check", () => {
  const GUARD_IMPORT = `--import ${pathToFileURL(resolve("scripts/bundle/offline-guard.mjs")).href}`;
  const clean = { PATH: "/bin", NODE_OPTIONS: GUARD_IMPORT, BUNDLE_TEST_CONFIGURATION: "fictional-only", OFFLINE_GUARD_LOG: "x", PRODUCTION_BUNDLE_DIR: "y" };

  it("accepts the runner's environment", () => {
    assert.deepEqual(environmentIsolationProblems(clean), []);
  });

  it("rejects credentials and service URLs by name, never echoing a value", () => {
    const value = "fictional-value-that-must-not-be-printed";
    const names = [
      "DATABASE_URL", "DATABASE_URL_UNPOOLED", "BETTER_AUTH_SECRET", "RATE_LIMIT_HMAC_SECRET", "TURNSTILE_SECRET_KEY",
      "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "R2_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "RESEND_API_KEY",
      "PGPASSWORD", "NEON_API_KEY", "NETLIFY_AUTH_TOKEN", "PRODUCTION_DATABASE_ENDPOINT", "ADMIN_BOOTSTRAP_PASSWORD",
    ];
    const problems = environmentIsolationProblems({ ...clean, ...Object.fromEntries(names.map((name) => [name, value])) });
    assert.equal(problems.length, names.length);
    for (const name of names) assert.ok(problems.some((problem) => problem.startsWith(`${name} `)), name);
    assert.ok(problems.every((problem) => !problem.includes(value)));
  });

  it("requires the fictional-configuration marker and the guard preload", () => {
    assert.deepEqual(environmentIsolationProblems({ PATH: "/bin" }), [
      "BUNDLE_TEST_CONFIGURATION must be fictional-only",
      "NODE_OPTIONS must preload the offline guard",
    ]);
  });

  it("reports an unguarded process without probing the network", () => {
    // `npm test` itself runs without the guard.
    assert.deepEqual(guardIsolationProblems(), ["the Node offline guard is not loaded in this process"]);
  });

  /** Runs the real check in a fresh Node process with a system-only environment. */
  function probe(extra: Record<string, string>) {
    const result = spawnSync(
      process.execPath,
      ["--require", "tsx/cjs", "-e", "require('./scripts/bundle/workspace.ts').assertBundleProcessIsolation(); console.log('ISOLATED')"],
      { cwd: process.cwd(), env: bundleEnv(process.env, extra) as unknown as NodeJS.ProcessEnv, encoding: "utf8" },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("passes in a guarded process, whose probe the guard refuses and logs as a self-test", () => {
    const dir = mkdtempSync(join(tmpdir(), "munir-isolation-test-"));
    try {
      const logFile = join(dir, "guard.log");
      writeFileSync(logFile, "");
      const run = probe({ NODE_OPTIONS: GUARD_IMPORT, BUNDLE_TEST_CONFIGURATION: "fictional-only", OFFLINE_GUARD_LOG: logFile });
      assert.equal(run.status, 0, run.output);
      assert.match(run.output, /ISOLATED/);
      const log = parseGuardLog(readFileSync(logFile, "utf8"));
      assert.equal(log.selfTests.length, 1);
      assert.equal(log.refusals.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a process without the guard", () => {
    const run = probe({ BUNDLE_TEST_CONFIGURATION: "fictional-only" });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /offline guard is not loaded/);
    assert.doesNotMatch(run.output, /ISOLATED/);
  });

  it("fails a guarded process that received a database URL, naming it without its value", () => {
    const value = "postgresql://fictional:fictional-password@db.example.invalid/fictional";
    const run = probe({ NODE_OPTIONS: GUARD_IMPORT, BUNDLE_TEST_CONFIGURATION: "fictional-only", DATABASE_URL: value });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /DATABASE_URL must be absent/);
    assert.ok(!run.output.includes("fictional-password"), "the value is never printed");
  });

  it("fails a guarded process without the fictional-configuration marker", () => {
    const run = probe({ NODE_OPTIONS: GUARD_IMPORT });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /BUNDLE_TEST_CONFIGURATION must be fictional-only/);
  });
});

describe("the bundle workspace cleanup", () => {
  // A fake temporary directory holding a fake repository and fake workspaces,
  // so nothing outside it is ever at stake.
  let root: string;
  let repo: string;
  let dependencies: string;
  let sentinel: string;
  let counter = 0;
  const linkType = process.platform === "win32" ? "junction" : "dir";

  before(() => {
    root = mkdtempSync(join(tmpdir(), "munir-cleanup-test-"));
    repo = join(root, "repo");
    dependencies = join(repo, "node_modules");
    sentinel = join(dependencies, "next", "package.json");
    mkdirSync(join(dependencies, "next"), { recursive: true });
    writeFileSync(sentinel, "{}");
  });

  after(() => {
    // Remove every link first, so this recursive delete can never follow one.
    for (const link of findLinks(root)) removeDependencyLink(link);
    assert.deepEqual(findLinks(root), []);
    rmSync(root, { recursive: true, force: true });
  });

  function workspace(withLink = true) {
    const path = join(root, `${WORKSPACE_PREFIX}${++counter}`);
    const link = join(path, "app", "node_modules");
    mkdirSync(join(path, "app", "src"), { recursive: true });
    writeFileSync(join(path, "app", "src", "file.ts"), "export {};");
    if (withLink) symlinkSync(dependencies, link, linkType);
    return { workspace: path, dependencyLink: link, temporaryRoot: root, repoRoot: repo, keep: false };
  }

  it("removes the junction as a link, deletes the workspace, and leaves the dependencies intact", () => {
    const target = workspace();
    assert.equal(isLink(target.dependencyLink), true, "the fixture is a real junction or symlink");
    assert.deepEqual(cleanupWorkspace(target), []);
    assert.equal(existsSync(target.workspace), false);
    assert.equal(readFileSync(sentinel, "utf8"), "{}");
  });

  it("is harmless when called again", () => {
    const target = workspace();
    assert.deepEqual(cleanupWorkspace(target), []);
    assert.deepEqual(cleanupWorkspace(target), []);
    assert.ok(existsSync(sentinel));
  });

  it("handles a partially initialized workspace without a link", () => {
    const target = workspace(false);
    assert.deepEqual(cleanupWorkspace(target), []);
    assert.equal(existsSync(target.workspace), false);
  });

  it("keeps the workspace on request but always removes the link", () => {
    const target = { ...workspace(), keep: true };
    assert.deepEqual(cleanupWorkspace(target), []);
    assert.equal(existsSync(target.workspace), true);
    assert.equal(existsSync(target.dependencyLink), false);
    assert.ok(existsSync(sentinel));
  });

  it("refuses a dependency path that is a real directory, deleting nothing", () => {
    const target = workspace(false);
    mkdirSync(target.dependencyLink);
    writeFileSync(join(target.dependencyLink, "keep.txt"), "x");
    const problems = cleanupWorkspace(target);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /not a link/);
    assert.ok(existsSync(join(target.dependencyLink, "keep.txt")));
  });

  it("refuses to delete a workspace that holds any other link, leaving its target untouched", () => {
    const target = workspace();
    symlinkSync(dependencies, join(target.workspace, "app", "src", "elsewhere"), linkType);
    const problems = cleanupWorkspace(target);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /holds links/);
    assert.equal(existsSync(target.workspace), true);
    assert.ok(existsSync(sentinel));
  });

  it("refuses paths that are not bundle workspaces in the temporary directory", () => {
    assert.match(workspaceRemovalProblem(repo, root, repo) ?? "", /not a bundle workspace/);
    assert.match(workspaceRemovalProblem(join(root, WORKSPACE_PREFIX), root, repo) ?? "", /not a bundle workspace/);
    assert.match(workspaceRemovalProblem(join(root, "nested", `${WORKSPACE_PREFIX}x`), root, repo) ?? "", /not a bundle workspace/);
    assert.match(workspaceRemovalProblem(join(root, `${WORKSPACE_PREFIX}x`), root, root) ?? "", /overlaps the repository/);
    assert.equal(cleanupWorkspace({ workspace: repo, dependencyLink: dependencies, temporaryRoot: root, repoRoot: repo, keep: false }).length, 1);
    assert.ok(existsSync(sentinel), "the fake repository and its dependencies survive");
  });

  it("refuses a dependency link outside the workspace", () => {
    const target = workspace();
    const problems = cleanupWorkspace({ ...target, dependencyLink: dependencies });
    assert.match(problems[0] ?? "", /not inside the workspace/);
    assert.ok(existsSync(sentinel));
  });
});
