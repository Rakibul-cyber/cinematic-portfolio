import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Admin download routes must be reached by a plain anchor, never `next/link`.
 *
 * Next.js prefetches every `Link` that is on screen. For a page that is
 * harmless; for a route handler the prefetch *is* the request: the signed-in
 * QA run of 2026-11-11 saw `/admin/inquiries/export` requested 15 times with no
 * click, and each of those runs the export and writes a `crm.exported` audit
 * entry. A plain `<a>` is only requested when someone follows it.
 *
 * The pages import Prisma and the Next.js runtime, so, as elsewhere in this
 * suite, the wiring is asserted from source.
 */

const ADMIN_APP = "src/app/(admin)/admin";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replaceAll("\\", "/");
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Every `<Link …>` opening tag in `source`, attributes included. */
function linkTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<Link", from);
    if (start < 0) return tags;
    // Attribute values contain `>` only inside `{…}` or quotes, so track depth.
    let depth = 0;
    let quote = "";
    let end = start;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

const all = files(ADMIN_APP);
/** The last path segment of each admin route handler, for example `export`. */
const handlerSegments = [...new Set(all.filter((file) => file.endsWith("/route.ts")).map((file) => file.split("/").at(-2) ?? ""))];
const views = [...all, ...files("src/components/admin")].filter((file) => file.endsWith(".tsx"));

describe("admin download links are not prefetched", () => {
  it("finds the export route handlers this rule protects", () => {
    assert.deepEqual(handlerSegments.sort(), ["export"]);
    assert.equal(all.filter((file) => file.endsWith("/export/route.ts")).length, 2);
  });

  it("the tag scanner reads a Link with braces and template strings", () => {
    assert.deepEqual(linkTags("<p><Link className={`${a} b`} href={`/x/${id}/export`}>Go</Link></p>"), ["<Link className={`${a} b`} href={`/x/${id}/export`}>"]);
  });

  it("no next/link element points at a route handler", () => {
    for (const file of views) {
      for (const tag of linkTags(readFileSync(file, "utf8"))) {
        for (const segment of handlerSegments) {
          assert.ok(!new RegExp(`/${segment}(["'\`?#/}]|$)`).test(tag), `${file}: a route handler must be linked with <a>, not <Link>: ${tag}`);
        }
      }
    }
  });

  it("the inquiries page offers the CSV export as a plain anchor", () => {
    const source = readFileSync(`${ADMIN_APP}/inquiries/page.tsx`, "utf8");
    assert.match(source, /<a className="[^"]*" download href="\/admin\/inquiries\/export">Export CSV<\/a>/);
  });

  it("the customer page offers the data export as a plain anchor", () => {
    const source = readFileSync(`${ADMIN_APP}/customers/[id]/page.tsx`, "utf8");
    assert.match(source, /<a className=\{[^}]*\}[^>]*\} download href=\{`\/admin\/customers\/\$\{id\}\/export`\}>Export customer data<\/a>/);
  });
});
