import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCard } from "@/components/public/project-card";
import type { PublicProjectSummary } from "@/server/public/view-models";

// The component's JSX compiles to the classic runtime outside Next.js.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const BASE: PublicProjectSummary = { slug: "harbour-light", title: "Harbour Light", summary: "", category: null, year: null, cover: null };

describe("project card without a category (MH-13)", () => {
  it("renders the title and link, and no empty category line", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectCard, { project: BASE }));
    assert.match(html, /href="\/work\/harbour-light"/);
    assert.match(html, /Harbour Light/);
    assert.doesNotMatch(html, /<p class="mt-1 text-xs text-muted-foreground"><\/p>/);
    assert.doesNotMatch(html, /mt-1 text-xs/);
  });

  it("still shows a category when the project has one", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectCard, { project: { ...BASE, category: { name: "Weddings", slug: "weddings" } } }));
    assert.match(html, /<p class="mt-1 text-xs text-muted-foreground">Weddings<\/p>/);
  });
});

describe("public pages without a category (MH-13)", () => {
  // Async Server Components that query the database: asserted from source, as elsewhere.
  it("guard every category read on the project page, home hero, and structured data", () => {
    const guards: [string, RegExp[]][] = [
      ["src/app/(public)/work/[slug]/page.tsx", [/\{project\.category \? \(\s*<p[^>]*>\s*\{project\.category\.name\}/, /value: project\.category\?\.name/]],
      ["src/components/sections/hero-section.tsx", [/\{hero\.category \? <span>\{hero\.category\.name\}<\/span> : null\}/]],
      ["src/server/seo/structured-data.ts", [/genre: project\.category\?\.name/]],
    ];
    for (const [file, patterns] of guards) {
      const source = readFileSync(file, "utf8");
      for (const pattern of patterns) assert.match(source, pattern, file);
      // Every `.category.name` read is one of the guarded reads above.
      assert.equal((source.match(/\.category\.name/g) ?? []).length, patterns.filter((p) => /category\\\.name/.test(p.source)).length, file);
    }
  });

  it("render no empty short description on the project page", () => {
    const source = readFileSync("src/app/(public)/work/[slug]/page.tsx", "utf8");
    assert.match(source, /\{project\.summary \? \(/);
  });
});
