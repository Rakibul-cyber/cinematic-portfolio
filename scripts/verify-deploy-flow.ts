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

  section("netlify config");

  assert.equal(tables.build?.command, "npm run build", "the production build runs");
  assert.equal(
    tables.build?.publish,
    ".next",
    "the Next.js build output is published, not a static export",
  );
  assert.ok(
    !source.includes('publish = "out"'),
    "a static export would drop server rendering, ISR, and the admin area",
  );
  assert.ok(
    tables["build.environment"]?.NPM_FLAGS?.includes("--include=dev"),
    "dev dependencies are installed: Prisma, TypeScript, and Tailwind run at build time",
  );

  section("ISR compatibility");

  assert.ok(
    plugins.includes("@netlify/plugin-nextjs"),
    "the Next.js Runtime provides server rendering, ISR, and on-demand revalidation",
  );

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

  for (const rule of headers) {
    if (!("Cache-Control" in rule.values)) continue;

    assert.ok(
      rule.for.startsWith("/_next/") ||
        rule.for.startsWith("/fonts/") ||
        rule.for.startsWith("/admin") ||
        rule.for === "/sitemap.xml" ||
        rule.for === "/robots.txt",
      `${rule.for} must not be given a cache rule: rendered routes are the ` +
        "Next.js runtime's to control",
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

  const image = headers.find((rule) => rule.for.startsWith("/_next/image"));
  assert.ok(image, "image handler output is cached");
  assert.ok(
    image!.values["Cache-Control"].includes("s-maxage="),
    "images are held by the shared cache rather than only by the browser",
  );

  const admin = headers.find((rule) => rule.for.startsWith("/admin"));
  assert.equal(
    admin?.values["Cache-Control"],
    "private, no-store",
    "the private workspace is never held by a shared cache",
  );

  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const rule = headers.find((entry) => entry.for === path);
    assert.ok(rule, `${path} has a cache rule`);
    assert.ok(
      rule!.values["Cache-Control"].includes("must-revalidate"),
      `${path} is revalidated: it changes whenever work is published`,
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
    "Deployment verification passed: Next.js runtime output with the ISR-capable " +
      "plugin, immutable caching for hashed assets, no cache rule shadowing " +
      "rendered routes, a private admin area, security headers owned solely by " +
      "the application, and no credentials in the repository.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Deployment verification failed",
  );
  process.exitCode = 1;
});
