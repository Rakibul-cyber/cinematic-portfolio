import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { securityHeaders } from "@/lib/security-headers";

/**
 * Verification of the Netlify production configuration.
 *
 * Deployment configuration fails quietly: a cache rule that shadows
 * Incremental Static Regeneration, or a security header declared in two places
 * that drift apart, produces a site that builds, deploys, and serves the wrong
 * thing. None of that is visible in a local run, so it is asserted here from
 * the file itself.
 *
 *   npm run deploy:verify
 */

const CONFIG = "netlify.toml";

type HeaderRule = { for: string; values: Record<string, string> };

function section(name: string): void {
  console.log(`  ${name}`);
}

/**
 * A deliberately small TOML reader for the subset this file uses: top-level
 * `key = "value"` pairs inside named tables, and repeated `[[headers]]` blocks
 * with a nested `[headers.values]` table. Enough to assert the contract
 * without adding a parser dependency for one configuration file.
 */
function parse(source: string): {
  tables: Record<string, Record<string, string>>;
  headers: HeaderRule[];
  plugins: string[];
} {
  const tables: Record<string, Record<string, string>> = {};
  const headers: HeaderRule[] = [];
  const plugins: string[] = [];

  let table = "";
  let rule: HeaderRule | null = null;
  let inValues = false;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();

    if (!line) continue;

    if (line === "[[headers]]") {
      rule = { for: "", values: {} };
      headers.push(rule);
      table = "headers";
      inValues = false;
      continue;
    }

    if (line === "[[plugins]]") {
      table = "plugins";
      rule = null;
      inValues = false;
      continue;
    }

    if (line === "[headers.values]") {
      inValues = true;
      continue;
    }

    const named = /^\[([^[\]]+)\]$/.exec(line);

    if (named) {
      table = named[1];
      rule = null;
      inValues = false;
      tables[table] ??= {};
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"$/.exec(line);

    if (!pair) continue;

    const [, key, value] = pair;

    if (rule) {
      if (inValues) rule.values[key] = value;
      else if (key === "for") rule.for = value;
      continue;
    }

    if (table === "plugins" && key === "package") {
      plugins.push(value);
      continue;
    }

    tables[table] ??= {};
    tables[table][key] = value;
  }

  return { tables, headers, plugins };
}

async function main(): Promise<void> {
  console.log("Verifying deployment configuration:");

  const source = await readFile(CONFIG, "utf8");
  const { tables, headers, plugins } = parse(source);

  section("zero-configuration adapter");

  // Netlify provisions the Next.js (OpenNext) adapter automatically and
  // recommends against pinning it. Declaring the plugin IS the pinning
  // pattern, so its absence is the correct state, not an omission.
  assert.deepEqual(
    plugins,
    [],
    "the Next.js adapter must not be pinned: Netlify provisions and updates it",
  );

  // The adapter owns the build output location. Naming one here freezes an
  // assumption about its internals whose failure mode is a green deploy that
  // serves 404s.
  assert.equal(
    tables.build?.publish,
    undefined,
    "no publish directory is pinned: the adapter decides where output lives",
  );
  assert.ok(
    !source.includes('publish = "out"'),
    "a static export would drop server rendering, ISR, and the admin area",
  );
  assert.equal(tables.build?.command, "npm run build", "the production build runs");
  assert.ok(
    tables["build.environment"]?.NPM_FLAGS?.includes("--include=dev"),
    "dev dependencies are installed: Prisma, TypeScript, and Tailwind run at build time",
  );

  section("node version");

  // `.node-version` is the highest-precedence mechanism Netlify reads, and
  // unlike NODE_VERSION in netlify.toml it is visible to every other tool.
  // Netlify does not read package.json `engines`.
  const nodeVersion = (await readFile(".node-version", "utf8")).trim();
  assert.match(
    nodeVersion,
    /^\d+(\.\d+){0,2}$/,
    ".node-version pins an explicit Node.js major",
  );
  assert.ok(
    Number.parseInt(nodeVersion, 10) >= 20,
    "the pinned Node.js version is current enough for Next.js 15 and Prisma 7",
  );
  assert.equal(
    tables["build.environment"]?.NODE_VERSION,
    undefined,
    "the Node version is declared once, in .node-version, not also here",
  );

  section("ISR compatibility");

  const blanket = headers.filter(
    (rule) =>
      (rule.for === "/*" || rule.for === "/**") && "Cache-Control" in rule.values,
  );
  assert.deepEqual(
    blanket,
    [],
    "a blanket cache rule would freeze stale pages in the CDN and make " +
      "on-demand revalidation invisible to visitors",
  );

  // Everything Next.js renders is the runtime's to cache -- including the
  // metadata routes, which carry their own `revalidate` and are not files.
  const RENDERED_ROUTES = [
    "/sitemap.xml",
    "/robots.txt",
    "/opengraph-image",
    "/work",
    "/contact",
    "/",
  ];

  for (const rule of headers) {
    if (!("Cache-Control" in rule.values)) continue;

    assert.ok(
      !RENDERED_ROUTES.includes(rule.for),
      `${rule.for} is rendered by Next.js with its own revalidate; a CDN rule ` +
        "would freeze it and hide on-demand revalidation",
    );
    assert.ok(
      rule.for.startsWith("/_next/static/") || rule.for.startsWith("/admin"),
      `${rule.for} must not be given a cache rule: only content-hashed build ` +
        "output and the private admin area are the CDN's to control",
    );
  }

  section("cache headers");

  const immutable = headers.find((rule) => rule.for === "/_next/static/*");
  assert.ok(immutable, "hashed build output is cached");
  assert.ok(
    immutable!.values["Cache-Control"].includes("immutable"),
    "content-hashed assets are immutable",
  );
  assert.ok(
    immutable!.values["Cache-Control"].includes("max-age=31536000"),
    "hashed assets are cached for a year",
  );

  // `immutable` is a promise that a URL's bytes can never change. Only
  // content-hashed paths can keep it.
  for (const rule of headers) {
    if (!rule.values["Cache-Control"]?.includes("immutable")) continue;

    assert.ok(
      rule.for.startsWith("/_next/static/"),
      `${rule.for} is marked immutable but is not content-addressed`,
    );
  }

  const admin = headers.find((rule) => rule.for.startsWith("/admin"));
  assert.equal(
    admin?.values["Cache-Control"],
    "private, no-store",
    "the private workspace is never held by a shared cache",
  );

  // No rule may reference a path the deployment does not produce. `next/image`
  // is unused (ADR 0005 serves R2 variants directly) and there is no public/
  // directory, so rules for those paths would be misleading dead configuration.
  for (const rule of headers) {
    assert.ok(
      !rule.for.startsWith("/_next/image") && !rule.for.startsWith("/fonts/"),
      `${rule.for} matches nothing this application deploys`,
    );
  }

  section("security headers coexistence");

  const applicationHeaders = securityHeaders({ NODE_ENV: "production" });
  const names = applicationHeaders.map((header) => header.key);

  assert.deepEqual(
    names,
    [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ],
    "the application still emits the full Phase 8 header set",
  );

  const declaredInNetlify = headers.flatMap((rule) => Object.keys(rule.values));

  for (const name of names) {
    assert.ok(
      !declaredInNetlify.includes(name),
      `${name} is declared in netlify.toml as well as by the application; ` +
        "two sources of truth for a security header will drift",
    );
  }

  const config = await readFile("next.config.ts", "utf8");
  assert.ok(
    config.includes("securityHeaders"),
    "the application is the single source of security headers",
  );

  assert.ok(
    !/[A-Za-z_]*(SECRET|API_KEY|PASSWORD|DATABASE_URL|DSN)[A-Za-z_]*\s*=\s*"[^"]+"/.test(
      source,
    ),
    "netlify.toml declares no credentials: production values belong in the Netlify UI",
  );

  console.log(
    "Deployment verification passed: zero-configuration adapter with nothing " +
      "pinned, an explicit Node version in .node-version, immutable caching " +
      "confined to content-addressed output, no cache rule shadowing a rendered " +
      "route, no rule matching a path the app does not deploy, a private admin " +
      "area, security headers owned solely by the application, and no " +
      "credentials in the repository.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Deployment verification failed",
  );
  process.exitCode = 1;
});
