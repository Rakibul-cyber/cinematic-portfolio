import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextProjectVersion } from "@/lib/cms/project-version";

const at = (iso: string) => new Date(iso);

describe("project version token", () => {
  it("uses the current time when the clock has advanced", () => {
    assert.equal(
      nextProjectVersion(
        at("2026-10-23T12:00:00.000Z"),
        at("2026-10-23T12:00:05.250Z"),
      ).toISOString(),
      "2026-10-23T12:00:05.250Z",
    );
  });

  it("advances by one millisecond for a same-millisecond save", () => {
    assert.equal(
      nextProjectVersion(
        at("2026-10-23T12:00:00.000Z"),
        at("2026-10-23T12:00:00.000Z"),
      ).toISOString(),
      "2026-10-23T12:00:00.001Z",
    );
  });

  it("still advances past the stored version when the clock runs behind", () => {
    assert.equal(
      nextProjectVersion(
        at("2026-10-23T12:00:00.000Z"),
        at("2026-10-23T11:59:59.000Z"),
      ).toISOString(),
      "2026-10-23T12:00:00.001Z",
    );
  });

  it("survives the ISO round trip used by the hidden form token", () => {
    const stored = nextProjectVersion(at("2026-10-23T12:00:00.999Z"));
    const token = new Date(stored.toISOString());

    assert.equal(token.getTime(), stored.getTime());
    assert.ok(nextProjectVersion(token, token) > token);
  });
});
