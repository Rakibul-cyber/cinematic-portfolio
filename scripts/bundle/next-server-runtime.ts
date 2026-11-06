/**
 * Loads the server output of a real `next build` (compile mode) into Next.js's
 * own webpack runtime, so tests can call the production-compiled modules.
 *
 * - `webpack-runtime.js`, every file in `server/chunks/`, and every App Router
 *   entry (`page.js`, `route.js`) are evaluated as CommonJS. Entries only
 *   register their modules: their top-level startup call is intercepted, so no
 *   page or route runs on load.
 * - Externals (`require("next/dist/...")`, `node:crypto`, ...) resolve from the
 *   repository's `node_modules`, so the build workspace needs no dependency
 *   link once the build is done.
 * - Modules are located by their compiled content, never by numeric id: ids
 *   are hashes of the build directory's path and change between builds.
 * - Only I/O boundaries are replaced, and only by the test that needs it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/**
 * Compiled webpack output is untyped JavaScript with minified export names, so
 * values crossing from it into a test are deliberately `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Compiled = any;

type Factory = (module: { exports: Compiled }, exports: Compiled, require: WebpackRequire) => void;
export type WebpackRequire = ((id: string | number) => Compiled) & {
  m: Record<string, Factory>;
  C: (chunk: Compiled) => void;
  d: unknown;
  r: unknown;
  o: unknown;
  n: unknown;
};

export type ServerRuntime = {
  require: WebpackRequire;
  /** Ids of every registered module whose compiled source satisfies `test`. */
  find: (test: (source: string) => boolean) => string[];
  /** The one module id satisfying `test`; throws when there are none or several. */
  findOne: (description: string, test: (source: string) => boolean) => string;
  source: (id: string) => string;
  /** Replaces a module's exports before it is first required. */
  stub: (id: string, exports: Compiled) => void;
  /** Runs one module's compiled factory afresh, resolving the given dependency ids to stubs. */
  runFactory: (id: string, dependencies: Record<string, Compiled>) => Compiled;
};

function walk(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, accept);
    return accept(entry.name) ? [path] : [];
  });
}

/** Every `.js` file under a directory, for content scans. */
export function compiledFiles(dir: string): string[] {
  return walk(dir, (name) => name.endsWith(".js"));
}

export function loadServerRuntime(serverDir: string, repoRoot: string): ServerRuntime {
  const server = resolve(serverDir);
  const repoRequire = createRequire(join(resolve(repoRoot), "package.json"));

  const evaluate = (file: string, overrides: Record<string, Compiled> = {}): Compiled => {
    const record = { exports: {} as Compiled };
    const localRequire = (specifier: string): Compiled => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = resolve(dirname(file), specifier);
        if (target.startsWith(server)) return evaluate(target.endsWith(".js") ? target : `${target}.js`);
      }
      return repoRequire(specifier);
    };
    const body = readFileSync(file, "utf8");
    new Function("exports", "require", "module", "__filename", "__dirname", body)(record.exports, localRequire, record, file, dirname(file));
    return record.exports;
  };

  const installed = evaluate(join(server, "webpack-runtime.js")) as WebpackRequire;
  for (const file of walk(join(server, "chunks"), (name) => name.endsWith(".js"))) installed.C(evaluate(file));

  // App Router entries register their own modules through `runtime.C(...)` and
  // then start themselves through `runtime.X(...)`. The start is skipped.
  const entryRuntime = { C: (chunk: Compiled) => installed.C(chunk), X: () => undefined };
  for (const file of walk(join(server, "app"), (name) => name === "page.js" || name === "route.js")) {
    const text = readFileSync(file, "utf8");
    const match = /require\("((?:\.\.\/)+webpack-runtime\.js)"\)/.exec(text);
    if (!match) continue;
    evaluate(file, { [match[1]]: entryRuntime });
  }

  const source = (id: string) => installed.m[id].toString();
  const find = (test: (source: string) => boolean) => Object.keys(installed.m).filter((id) => test(source(id)));
  return {
    require: installed,
    find,
    source,
    findOne(description, test) {
      const ids = find(test);
      if (ids.length !== 1) throw new Error(`Expected exactly one compiled module for ${description}, found ${ids.length}.`);
      return ids[0];
    },
    stub(id, exports) {
      installed.m[id] = (record) => {
        record.exports = exports;
      };
    },
    runFactory(id, dependencies) {
      const record = { exports: {} as Compiled };
      const localRequire = Object.assign(
        (dependency: string | number) => (String(dependency) in dependencies ? dependencies[String(dependency)] : installed(dependency)),
        { m: installed.m, C: installed.C, d: installed.d, r: installed.r, o: installed.o, n: installed.n },
      ) as WebpackRequire;
      installed.m[id](record, record.exports, localRequire);
      return record.exports;
    },
  };
}

/** The numeric ids a compiled module requires, in order of appearance. */
export function dependencyIds(moduleSource: string): string[] {
  // A factory is `(module, exports, require) => {...}`; the third name is webpack's require.
  const signature = /^(?:function\s*)?\(?\s*[\w$]+\s*,\s*[\w$]+\s*,\s*([\w$]+)\s*\)?\s*(?:=>|\{)/.exec(moduleSource);
  if (!signature) throw new Error("Unrecognized compiled module signature.");
  const name = signature[1].replace(/\$/g, "\\$");
  return [...moduleSource.matchAll(new RegExp(`(?<![\\w$.])${name}\\((\\d+)\\)`, "g"))].map((match) => match[1]);
}

/**
 * Exports for a stubbed module whose export names are minified: every name
 * resolves to `value`. `then` stays undefined so webpack's async-module
 * handling does not mistake the stub for a promise.
 */
export function anyExportStub(value: Compiled): Compiled {
  return new Proxy(
    {},
    {
      get: (_target, name) => (name === "then" || typeof name === "symbol" ? undefined : name === "__esModule" ? true : value),
    },
  );
}

export type PrismaCall = { model: string; operation: string; args: Compiled };
export type FakePrisma = {
  client: Compiled;
  calls: PrismaCall[];
  handlers: Record<string, (args: Compiled) => unknown>;
  failTransactions: boolean;
  reset: () => void;
};

const DEFAULT_RESULTS: Record<string, (args: Compiled) => unknown> = {
  findUnique: () => null,
  findUniqueOrThrow: () => {
    throw new Error("fake prisma: no record");
  },
  findFirst: () => null,
  findMany: () => [],
  count: () => 0,
  create: (args) => ({ id: "00000000-0000-4000-8000-000000000001", ...(args?.data ?? {}) }),
  update: (args) => ({ id: args?.where?.id ?? "00000000-0000-4000-8000-000000000001", ...(args?.data ?? {}) }),
  upsert: (args) => ({ id: args?.where?.id ?? "00000000-0000-4000-8000-000000000001" }),
  delete: (args) => ({ id: args?.where?.id }),
  createMany: () => ({ count: 0 }),
  updateMany: () => ({ count: 0 }),
  deleteMany: () => ({ count: 0 }),
};

/**
 * An in-memory stand-in for the Prisma client, injected through the
 * application's own `globalThis.cinematicPortfolioPrisma` singleton seam in
 * `src/server/db/prisma.ts`, so no real client or connection is ever created.
 *
 * Every model call is recorded. `$queryRaw` is answered by the
 * `$queryRaw` handler; rate-limit bucket increments get real per-bucket
 * counting from `createBucketCounter`.
 */
export function createFakePrisma(): FakePrisma {
  const fake: FakePrisma = {
    calls: [],
    handlers: {},
    failTransactions: false,
    client: undefined,
    reset() {
      fake.calls.length = 0;
      fake.handlers = {};
      fake.failTransactions = false;
    },
  };
  const answer = (model: string, operation: string, args: Compiled) => {
    fake.calls.push({ model, operation, args });
    const handler = fake.handlers[`${model}.${operation}`] ?? DEFAULT_RESULTS[operation];
    if (!handler) throw new Error(`fake prisma: unsupported ${model}.${operation}`);
    return handler(args);
  };
  const special: Record<string, Compiled> = {
    $transaction: async (work: Compiled) => {
      fake.calls.push({ model: "$transaction", operation: "$transaction", args: undefined });
      if (fake.failTransactions) throw new Error("fake prisma: storage unavailable");
      return typeof work === "function" ? work(fake.client) : Promise.all(work);
    },
    $queryRaw: async (query: Compiled) => answer("$raw", "$queryRaw", query),
    $executeRaw: async (query: Compiled) => {
      fake.calls.push({ model: "$raw", operation: "$executeRaw", args: query });
      return 0;
    },
    $connect: async () => undefined,
    $disconnect: async () => undefined,
  };
  fake.client = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name === "symbol" || name === "then") return undefined;
        if (name in special) return special[name];
        return new Proxy(
          {},
          {
            get: (_model, operation) =>
              typeof operation === "symbol" || operation === "then" ? undefined : async (args: Compiled) => answer(name, operation, args),
          },
        );
      },
    },
  );
  return fake;
}

/**
 * Real fixed-window counting for `INSERT ... ON CONFLICT ... RETURNING "count"`
 * bucket statements, keyed on the statement's own scope, key hash, and window.
 * Values follow `incrementBucketSql`: [id, scope, keyHash, windowStart, expiresAt, now, now].
 */
export function createBucketCounter() {
  const counts = new Map<string, number>();
  const increments: Array<{ scope: string; keyHash: string; values: unknown[] }> = [];
  return {
    increments,
    counts,
    handle(query: Compiled): Array<{ count: number }> {
      const text: string = (query?.strings ?? []).join("?") || String(query?.sql ?? "");
      if (!text.includes('INSERT INTO "rate_limit_bucket"')) throw new Error("fake prisma: unexpected raw query");
      const values: unknown[] = query.values;
      const [, scope, keyHash, windowStart] = values as [string, string, string, Date];
      const key = `${scope}|${keyHash}|${new Date(windowStart).toISOString()}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      increments.push({ scope, keyHash, values });
      return [{ count }];
    },
  };
}
