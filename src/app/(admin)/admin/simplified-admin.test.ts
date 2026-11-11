import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * MH-15: the admin was simplified for a non-technical studio owner. Categories
 * and Testimonials were removed from the application entirely, the dashboard
 * and navigation were reduced to the everyday sections, and nothing in the
 * database was dropped. These tests keep the removed features from drifting
 * back in and keep the data model intact.
 *
 * The pages import Prisma and the Next.js runtime, so, as elsewhere in this
 * suite, their wiring is asserted from source.
 */

const ADMIN = "src/app/(admin)/admin";
const read = (file: string) => readFileSync(file, "utf8");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replaceAll("\\", "/");
    return entry.isDirectory() ? files(path) : [path];
  });
}

/**
 * Application source, without tests, comments, or the generated Prisma client.
 * The temporary project-save diagnostic is left out: it inspects the
 * `categoryId` column's nullability and is due for removal on its own (F-3).
 */
const sources = files("src")
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|render-test)\.ts$/.test(file) && !file.startsWith("src/generated/") && !/^src\/(lib|server)\/diagnostics\//.test(file))
  .map((file) => [file, read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")] as const);

describe("categories and testimonials are removed (MH-15)", () => {
  it("their admin pages no longer exist, so the addresses give the admin 404", () => {
    assert.equal(existsSync(`${ADMIN}/categories`), false);
    assert.equal(existsSync(`${ADMIN}/testimonials`), false);
    // The catch-all that answers unknown admin addresses is still there.
    assert.equal(existsSync(`${ADMIN}/[...missing]/page.tsx`), true);
  });

  it("no server action, service, or schema for them remains", () => {
    const actions = read(`${ADMIN}/cms-actions.ts`);
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
    assert.deepEqual(exported, ["saveServiceAction", "savePageAction", "saveSettingsAction", "saveSocialAction", "saveProjectAction", "deleteAction"]);
    assert.match(actions, /\.enum\(\["project", "service", "socialLink"\]\)/);

    const service = read("src/server/cms/service.ts");
    assert.doesNotMatch(service, /saveCategory|deleteCategory|saveTestimonial|ReferencedCategoryError/);
    assert.match(service, /kind: "service" \| "socialLink",/);

    assert.doesNotMatch(read("src/lib/validation/cms.ts"), /categorySchema|testimonialSchema/);
  });

  it("application code never touches the category or testimonial tables", () => {
    for (const [file, source] of sources) {
      assert.doesNotMatch(source, /prisma\.(portfolioCategory|testimonial)\b|\btx\.(portfolioCategory|testimonial)\b/, file);
      assert.doesNotMatch(source, /\/admin\/(categories|testimonials)/, file);
      assert.doesNotMatch(source, /categoryId|testimonial/i, file);
    }
  });

  it("public visibility is decided by Published alone", () => {
    assert.match(read("src/server/public/publication.ts"), /export const PUBLISHED_PROJECT_WHERE = \{\s*status: "PUBLISHED",\s*\} satisfies/);
  });

  it("the database schema is untouched: tables and the column stay, with no new migration", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model PortfolioCategory \{/);
    assert.match(schema, /model Testimonial \{/);
    assert.match(schema, /categoryId\s+String\?/);
    assert.match(schema, /category PortfolioCategory\? @relation\(fields: \[categoryId\], references: \[id\], onDelete: Restrict\)/);
    assert.equal(readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).length, 9);
  });
});

describe("simplified dashboard and navigation (MH-15)", () => {
  const dashboard = read(`${ADMIN}/page.tsx`);

  it("the dashboard shows six counters", () => {
    const labels = [...dashboard.matchAll(/^\s*\["([^"]+)", \w[^\]]*\],$/gm)].map((match) => match[1]);
    assert.deepEqual(labels, ["Projects", "Published", "Drafts", "Media", "New inquiries", "Open inquiries"]);
    assert.doesNotMatch(dashboard, /prisma\.(service|testimonial)\.count/);
  });

  it("the dashboard offers three quick actions", () => {
    const actions = [...dashboard.matchAll(/href="([^"]+)"\s*>\s*([^<]+?)\s*<\/Link>/g)].map((match) => [match[1], match[2]]);
    assert.deepEqual(actions, [
      ["/admin/projects/new", "New project"],
      ["/admin/media", "Upload media"],
      ["/admin/inquiries", "View inquiries"],
    ]);
  });

  it("the sidebar lists the six everyday links, then a quieter Website content group", () => {
    const shell = read("src/components/admin/admin-shell.tsx");
    const primary = shell.indexOf("{adminLinksFor(user.role).map(");
    const label = shell.indexOf("Website content");
    const secondary = shell.indexOf("{ADMIN_CONTENT_LINKS.map(");
    const navEnd = shell.indexOf("</nav>");
    assert.ok(primary > 0 && primary < label && label < secondary && secondary < navEnd, "primary links, label, secondary links, all inside the one nav");
    // The secondary links are visibly quieter than the primary ones.
    assert.match(shell.slice(secondary, navEnd), /text-xs text-muted-foreground/);
  });

  it("Services and Pages still exist and keep their own guards", () => {
    assert.match(read(`${ADMIN}/services/page.tsx`), /requireUser\("\/admin\/services"\)/);
    assert.match(read(`${ADMIN}/pages/page.tsx`), /requireUser\("\/admin\/pages"\)/);
  });
});

describe("project form (MH-15)", () => {
  const form = read("src/components/admin/project-form.tsx");

  it('calls the optional section "More options (optional)"', () => {
    assert.match(form, /<summary[^>]*>\s*More options \(optional\)\s*<\/summary>/);
    assert.doesNotMatch(form, /Advanced details/);
  });

  it("keeps every project field, so a save never clears stored values", () => {
    const names = [...form.matchAll(/name="(\w+)"/g)].map((match) => match[1]);
    for (const name of ["title", "summary", "status", "slug", "description", "clientName", "location", "projectDate", "sortOrder", "featured", "seoTitle", "seoDescription"]) {
      assert.ok(names.includes(name), `field ${name} is still in the form`);
    }
    assert.match(form, /<ProjectMediaPicker/);
    assert.match(form, /<ProjectVideoField/);
  });
});
