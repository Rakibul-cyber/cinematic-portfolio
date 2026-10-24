import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { navigation } from "@/content/site";
import { isCurrentSection } from "@/lib/public/navigation";

/**
 * Phase 10D-2A: the mobile menu used an exact pathname match, so a project
 * page left Work unmarked. Both menus now share this rule.
 */

const current = (pathname: string) =>
  navigation
    .filter((item) => isCurrentSection(pathname, item.href))
    .map((item) => item.label);

describe("current navigation section", () => {
  it("marks Work on the index and on nested project pages", () => {
    assert.deepEqual(current("/work"), ["Work"]);
    assert.deepEqual(current("/work/example-project"), ["Work"]);
    assert.deepEqual(current("/work/"), ["Work"]);
  });

  it("marks each other section on its own route", () => {
    assert.deepEqual(current("/services"), ["Services"]);
    assert.deepEqual(current("/about"), ["About"]);
    assert.deepEqual(current("/contact"), ["Contact"]);
  });

  it("does not treat a shared prefix as nesting", () => {
    assert.deepEqual(current("/workshop"), []);
    assert.deepEqual(current("/contact-us"), []);
  });

  it("marks nothing on the homepage or unrelated routes", () => {
    assert.deepEqual(current("/"), []);
    assert.deepEqual(current("/privacy"), []);
  });

  it("treats the root as current only on the homepage itself", () => {
    assert.equal(isCurrentSection("/", "/"), true);
    assert.equal(isCurrentSection("/work", "/"), false);
    assert.equal(isCurrentSection("/work/example-project", "/"), false);
  });

  it("is the rule both the desktop and mobile menus use", () => {
    for (const file of [
      "src/components/layout/primary-nav.tsx",
      "src/components/layout/mobile-navigation.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /from "@\/lib\/public\/navigation"/, file);
      assert.match(source, /isCurrentSection\(pathname, item\.href\)/, file);
      assert.doesNotMatch(source, /pathname === item\.href/, file);
    }
  });
});
