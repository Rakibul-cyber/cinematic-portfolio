import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCard } from "@/components/public/project-card";
import type { PublicProjectSummary } from "@/server/public/view-models";

// The component's JSX compiles to the classic runtime outside Next.js.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const BASE: PublicProjectSummary = { slug: "harbour-light", title: "Harbour Light", summary: "", year: null, cover: null };

describe("project card (no categories, MH-15)", () => {
  it("renders the title and link, and no category line", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectCard, { project: BASE }));
    assert.match(html, /href="\/work\/harbour-light"/);
    assert.match(html, /Harbour Light/);
    assert.doesNotMatch(html, /mt-1 text-xs/);
  });
});

describe("public pages show no category or testimonial (MH-15)", () => {
  // Async Server Components that query the database: asserted from source, as elsewhere.
  const pages = [
    "src/app/(public)/page.tsx",
    "src/app/(public)/about/page.tsx",
    "src/app/(public)/services/page.tsx",
    "src/app/(public)/work/page.tsx",
    "src/app/(public)/work/[slug]/page.tsx",
    "src/components/public/project-card.tsx",
    "src/components/sections/hero-section.tsx",
    "src/server/seo/structured-data.ts",
    "src/server/public/queries.ts",
    "src/server/public/mappers.ts",
    "src/server/public/view-models.ts",
  ];

  it("no public page, component, or query reads a category or a testimonial", () => {
    for (const file of pages) {
      // Code only: the work page's comment explains what an old
      // `?category=` link now does.
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(source, /categor|testimonial/i, file);
    }
  });

  it("the removed public components are gone", () => {
    for (const file of ["src/components/public/category-filter.tsx", "src/components/public/testimonial-list.tsx", "src/components/sections/testimonials-section.tsx"]) {
      assert.equal(existsSync(file), false, file);
    }
  });

  it("the work page takes no query parameters", () => {
    const source = readFileSync("src/app/(public)/work/page.tsx", "utf8");
    assert.doesNotMatch(source, /searchParams/);
    assert.match(source, /const visible = await getPublishedProjects\(\);/);
  });

  it("render no empty short description on the project page", () => {
    const source = readFileSync("src/app/(public)/work/[slug]/page.tsx", "utf8");
    assert.match(source, /\{project\.summary \? \(/);
  });
});
