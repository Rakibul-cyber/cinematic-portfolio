import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deletionEligibility } from "@/lib/video-eligibility";
import {
  VIDEO_MESSAGE_CODES,
  isVideoMessageCode,
  toVideoFailureCode,
  videoDeletionMessage,
  videoErrorMessage,
  videoTitleErrorMessage,
  videoUrlErrorMessage,
} from "@/lib/video-messages";
import { validateVideoTitle } from "@/lib/video-status";
import type { VideoUrlError } from "@/lib/video-url";

describe("video admin messages", () => {
  it("cover upload, processing, deletion, link, and title failures", () => {
    for (const code of [
      "upload_failed", "upload_interrupted", "upload_expired", "upload_cancelled", "file_too_large", "unsupported_file",
      "too_many_uploads", "rate_limited", "not_configured", "processing_failed", "input_unsupported", "duration_exceeded",
      "delete_assigned", "delete_upload_in_progress", "delete_in_progress", "delete_failed",
    ]) {
      assert.equal(isVideoMessageCode(code), true, code);
    }
  });

  it("are plain sentences without technical detail", () => {
    for (const code of VIDEO_MESSAGE_CODES) {
      const message = videoErrorMessage(code);
      assert.match(message, /^[A-Z].*\.$/, code);
      assert.doesNotMatch(message, /\b(error code|exception|stack|undefined|null|HTTP|API|Mux|webhook|token)\b/i, code);
    }
  });

  it("never echo unknown input, including raw provider text", () => {
    const generic = videoErrorMessage("unknown");
    for (const value of ["Asset ingest failed: invalid moov atom", "<script>alert(1)</script>", "", null, undefined, 42, "__proto__", "toString", "constructor"]) {
      assert.equal(videoErrorMessage(value), generic, String(value));
    }
  });

  it("reduce stored failures to a known code", () => {
    assert.equal(toVideoFailureCode("duration_exceeded"), "duration_exceeded");
    assert.equal(toVideoFailureCode("Unexpected codec hvc2 at offset 4096"), "processing_failed");
    assert.equal(toVideoFailureCode(undefined), "processing_failed");
  });

  it("map every link error to a helpful message", () => {
    const errors: VideoUrlError[] = [
      "empty", "too_long", "not_a_url", "unsupported_scheme", "credentials_not_allowed",
      "unsupported_host", "missing_id", "invalid_id", "invalid_hash",
    ];
    for (const error of errors) assert.notEqual(videoUrlErrorMessage(error), videoErrorMessage("unknown"), error);
    assert.match(videoUrlErrorMessage("unsupported_host"), /YouTube and Vimeo/);
    assert.match(videoUrlErrorMessage("invalid_hash"), /privacy code/);
  });

  it("map title and deletion results", () => {
    const title = validateVideoTitle("");
    assert.equal(title.ok, false);
    if (!title.ok) assert.equal(videoTitleErrorMessage(title), "Enter a title for the video.");
    const deletion = deletionEligibility({ status: "READY" }, 2);
    assert.equal(deletion.allowed, false);
    if (!deletion.allowed) assert.match(videoDeletionMessage(deletion), /Remove it from every project/);
  });
});
