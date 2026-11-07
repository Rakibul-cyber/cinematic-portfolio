import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { decideProjectCategory } from "@/lib/cms/project-category";

const CHOSEN = "123e4567-e89b-12d3-a456-426614174000";
const FIRST = "323e4567-e89b-12d3-a456-426614174000";

describe("project category without a manual choice", () => {
  it("gives a new project the first active category", () => {
    assert.deepEqual(decideProjectCategory({ chosen: null, isNew: true, firstActiveCategoryId: FIRST }), { kind: "set", categoryId: FIRST });
  });

  it("refuses a new project when no active category exists, instead of creating one", () => {
    assert.deepEqual(decideProjectCategory({ chosen: null, isNew: true, firstActiveCategoryId: null }), { kind: "missing" });
  });

  it("keeps an existing project's category when none is chosen", () => {
    assert.deepEqual(decideProjectCategory({ chosen: null, isNew: false, firstActiveCategoryId: FIRST }), { kind: "keep" });
    assert.deepEqual(decideProjectCategory({ chosen: null, isNew: false, firstActiveCategoryId: null }), { kind: "keep" });
  });

  it("uses a category the editor chose, for new and existing projects", () => {
    assert.deepEqual(decideProjectCategory({ chosen: CHOSEN, isNew: true, firstActiveCategoryId: FIRST }), { kind: "set", categoryId: CHOSEN });
    assert.deepEqual(decideProjectCategory({ chosen: CHOSEN, isNew: false, firstActiveCategoryId: null }), { kind: "set", categoryId: CHOSEN });
  });
});

describe("saveProject category wiring", () => {
  const source = readFileSync("src/server/cms/service.ts", "utf8");
  const body = source.slice(source.indexOf("export async function saveProject("), source.indexOf("export async function deleteProject("));

  it("looks up only an active category, in the public display order, and never creates one", () => {
    assert.match(body, /portfolioCategory\.findFirst\(\{\s*where: \{ isActive: true \},\s*orderBy: \[\{ sortOrder: "asc" \}, \{ name: "asc" \}\]/);
    assert.doesNotMatch(body, /portfolioCategory\.(create|upsert|update)/);
    assert.match(body, /decideProjectCategory\(/);
  });

  it("writes no categoryId on an update without a choice", () => {
    assert.match(body, /const categoryField = category\.kind === "set" \? \{ categoryId: category\.categoryId \} : \{\}/);
    assert.match(body, /data: \{\s*\.\.\.fields,\s*\.\.\.categoryField,/);
  });
});
