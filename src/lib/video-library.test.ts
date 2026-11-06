import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatVideoDuration,
  formatVideoResolution,
  isVideoInFlight,
  videoDeleteConfirmation,
  videoRowActions,
  videoStatusDetail,
  videoStatusLabel,
} from "@/lib/video-library";
import { VIDEO_STATUSES } from "@/lib/video-status";

describe("video library presentation (P3-11D)", () => {
  it("formats durations and resolutions, with a dash when unknown", () => {
    assert.equal(formatVideoDuration(65), "1:05");
    assert.equal(formatVideoDuration(42.5), "0:43");
    assert.equal(formatVideoDuration(3723), "1:02:03");
    assert.equal(formatVideoDuration(null), "—");
    assert.equal(formatVideoDuration(Number.NaN), "—");
    assert.equal(formatVideoResolution({ width: 3840, height: 2160, maxResolution: "2160p" }), "3840 × 2160 (2160p)");
    assert.equal(formatVideoResolution({ width: 1920, height: 1080, maxResolution: "<b>odd</b>" }), "1920 × 1080");
    assert.equal(formatVideoResolution({ width: null, height: null, maxResolution: null }), "—");
  });

  it("labels every status and polls only while a video is in flight", () => {
    for (const status of VIDEO_STATUSES) assert.ok(videoStatusLabel(status).length > 0);
    assert.deepEqual(VIDEO_STATUSES.filter(isVideoInFlight), ["UPLOAD_PENDING", "PROCESSING", "DELETING"]);
  });

  it("offers preview only for READY, cancel only for an active upload", () => {
    for (const status of VIDEO_STATUSES) {
      const actions = videoRowActions({ status, assignmentCount: 0 });
      assert.equal(actions.preview, status === "READY", status);
      assert.equal(actions.cancel, status === "UPLOAD_PENDING", status);
    }
  });

  it("offers Delete for eligible videos, Retry delete after a failure, and nothing while assigned", () => {
    assert.equal(videoRowActions({ status: "READY", assignmentCount: 0 }).delete, "delete");
    assert.equal(videoRowActions({ status: "PROCESSING", assignmentCount: 0 }).delete, "delete");
    assert.equal(videoRowActions({ status: "FAILED", assignmentCount: 0 }).delete, "delete");
    assert.equal(videoRowActions({ status: "CANCELLED", assignmentCount: 0 }).delete, "delete");
    assert.equal(videoRowActions({ status: "DELETE_FAILED", assignmentCount: 0 }).delete, "retry");
    assert.equal(videoRowActions({ status: "UPLOAD_PENDING", assignmentCount: 0 }).delete, null);
    assert.equal(videoRowActions({ status: "DELETING", assignmentCount: 0 }).delete, null);
    const assigned = videoRowActions({ status: "READY", assignmentCount: 2 });
    assert.equal(assigned.delete, null);
    assert.match(assigned.deleteBlockedMessage ?? "", /used by a project/);
  });

  it("explains failures with known messages only", () => {
    assert.match(videoStatusDetail({ status: "FAILED", failureCode: "input_unsupported" }) ?? "", /H\.264 or HEVC/);
    assert.match(videoStatusDetail({ status: "FAILED", failureCode: null }) ?? "", /could not be processed/);
    assert.match(videoStatusDetail({ status: "DELETE_FAILED", failureCode: null }) ?? "", /could not be deleted/);
    assert.match(videoStatusDetail({ status: "PROCESSING", failureCode: null }) ?? "", /preparing/);
    assert.equal(videoStatusDetail({ status: "READY", failureCode: null }), null);
  });

  it("names the video and the irreversibility in the confirmation", () => {
    const text = videoDeleteConfirmation("Brand film");
    assert.match(text, /Brand film/);
    assert.match(text, /Permanently delete/);
    assert.match(text, /cannot be recovered/);
  });
});
