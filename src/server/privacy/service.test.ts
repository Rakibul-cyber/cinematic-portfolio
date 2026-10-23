import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("privacy anonymization", () => {
  it("removes free-text projectType in the existing inquiry update", async () => {
    const source = await readFile("src/server/privacy/service.ts", "utf8");

    assert.match(
      source,
      /projectType:\s*"\[Removed during privacy anonymization\]"/,
    );
    assert.equal(
      (source.match(/tx\.inquiry\.updateMany/g) ?? []).length,
      1,
      "the fix stays inside the existing transaction and workflow",
    );
  });
});
