import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InvalidVideoTransitionError,
  VIDEO_STATUSES,
  VIDEO_TITLE_MAX_LENGTH,
  allowedNextStatuses,
  assertTransition,
  canTransition,
  isValidProviderId,
  isVideoStatus,
  transitionDecision,
  validateVideoTitle,
  type VideoStatus,
} from "@/lib/video-status";

describe("video statuses", () => {
  it("are exactly the MVP set", () => {
    assert.deepEqual([...VIDEO_STATUSES], ["UPLOAD_PENDING", "PROCESSING", "READY", "FAILED", "CANCELLED", "DELETING", "DELETE_FAILED"]);
    assert.equal(isVideoStatus("READY"), true);
    for (const value of ["ready", "DELETED", "", null, 3, undefined]) assert.equal(isVideoStatus(value), false);
  });
});

describe("video status transitions", () => {
  const allowed: Array<[VideoStatus, VideoStatus]> = [
    ["UPLOAD_PENDING", "PROCESSING"],
    ["UPLOAD_PENDING", "FAILED"],
    ["UPLOAD_PENDING", "CANCELLED"],
    ["PROCESSING", "READY"],
    ["PROCESSING", "FAILED"],
    ["PROCESSING", "DELETING"],
    ["READY", "DELETING"],
    ["FAILED", "DELETING"],
    ["CANCELLED", "DELETING"],
    ["DELETING", "DELETE_FAILED"],
    ["DELETE_FAILED", "DELETING"],
  ];

  it("allow exactly the documented forward moves", () => {
    for (const from of VIDEO_STATUSES) {
      for (const to of VIDEO_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
      }
    }
  });

  it("never move backwards or resurrect a finished upload", () => {
    for (const [from, to] of [
      ["READY", "PROCESSING"],
      ["READY", "UPLOAD_PENDING"],
      ["FAILED", "READY"],
      ["CANCELLED", "PROCESSING"],
      ["DELETING", "READY"],
      ["DELETE_FAILED", "READY"],
      ["UPLOAD_PENDING", "READY"],
    ] as Array<[VideoStatus, VideoStatus]>) {
      assert.equal(transitionDecision(from, to), "reject", `${from} -> ${to}`);
      assert.throws(() => assertTransition(from, to), InvalidVideoTransitionError);
    }
  });

  it("treat a repeated status as a no-op, so duplicate events are safe", () => {
    for (const status of VIDEO_STATUSES) {
      assert.equal(transitionDecision(status, status), "noop");
      assert.doesNotThrow(() => assertTransition(status, status));
    }
  });

  it("leave every status with a way forward", () => {
    for (const status of VIDEO_STATUSES) assert.ok(allowedNextStatuses(status).length > 0, status);
  });
});

describe("video title validation", () => {
  it("trims and collapses whitespace", () => {
    assert.deepEqual(validateVideoTitle("  Wedding   film\n2026 "), { ok: true, value: "Wedding film 2026" });
  });

  it("requires a title of at most 160 characters", () => {
    assert.deepEqual(validateVideoTitle(""), { ok: false, error: "title_required" });
    assert.deepEqual(validateVideoTitle("   "), { ok: false, error: "title_required" });
    assert.deepEqual(validateVideoTitle(undefined), { ok: false, error: "title_required" });
    assert.deepEqual(validateVideoTitle(42), { ok: false, error: "title_required" });
    assert.equal(validateVideoTitle("a".repeat(VIDEO_TITLE_MAX_LENGTH)).ok, true);
    assert.deepEqual(validateVideoTitle("a".repeat(VIDEO_TITLE_MAX_LENGTH + 1)), { ok: false, error: "title_too_long" });
  });

  it("refuses control characters", () => {
    assert.deepEqual(validateVideoTitle("Film\u0000"), { ok: false, error: "title_invalid" });
    assert.deepEqual(validateVideoTitle("Film\u001b[31m"), { ok: false, error: "title_invalid" });
  });

  it("keeps non-Latin and punctuated titles", () => {
    assert.deepEqual(validateVideoTitle("Hochzeit in München — Teil 2"), { ok: true, value: "Hochzeit in München — Teil 2" });
  });
});

describe("provider identifier validation", () => {
  it("accepts bounded alphanumeric identifiers only", () => {
    assert.equal(isValidProviderId("a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M"), true);
    assert.equal(isValidProviderId("ABCDEFGHIJ"), true);
    for (const value of ["", "short", "has space here", "../../etc/passwd", "abc-def-ghi-jkl", "x".repeat(129), null, 12345678901]) {
      assert.equal(isValidProviderId(value), false, String(value));
    }
  });
});
