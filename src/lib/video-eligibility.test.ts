import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PUBLISHED_PROJECT_WHERE } from "@/server/public/publication";
import { deletionEligibility, isPubliclyEligible, publicEligibility, type ProjectAssignment } from "@/lib/video-eligibility";
import { VIDEO_STATUSES } from "@/lib/video-status";

const published: ProjectAssignment = { projectStatus: "PUBLISHED", categoryActive: true };
const draft: ProjectAssignment = { projectStatus: "DRAFT", categoryActive: true };
const inactiveCategory: ProjectAssignment = { projectStatus: "PUBLISHED", categoryActive: false };
const ready = { status: "READY" as const };

describe("public video eligibility", () => {
  it("matches the project publication rule used by every public query", () => {
    assert.deepEqual(PUBLISHED_PROJECT_WHERE, { status: "PUBLISHED", category: { isActive: true } });
  });

  it("is granted only to a READY video in a published project with an active category", () => {
    assert.deepEqual(publicEligibility(ready, [published]), { eligible: true });
  });

  it("is refused for drafts, unassigned videos, and inactive categories", () => {
    assert.deepEqual(publicEligibility(ready, []), { eligible: false, reason: "unassigned" });
    assert.deepEqual(publicEligibility(ready, [draft]), { eligible: false, reason: "no_published_project" });
    assert.deepEqual(publicEligibility(ready, [inactiveCategory]), { eligible: false, reason: "no_published_project" });
    assert.deepEqual(publicEligibility(ready, [{ projectStatus: "DRAFT", categoryActive: false }]), {
      eligible: false,
      reason: "no_published_project",
    });
  });

  it("is refused for every status other than READY, even in a published project", () => {
    for (const status of VIDEO_STATUSES.filter((s) => s !== "READY")) {
      assert.deepEqual(publicEligibility({ status }, [published]), { eligible: false, reason: "not_ready" }, status);
    }
  });

  it("holds while any one of several sharing projects qualifies", () => {
    assert.equal(isPubliclyEligible(ready, [draft, inactiveCategory, published]), true);
    assert.equal(isPubliclyEligible(ready, [draft, inactiveCategory]), false, "unpublishing the last public project revokes it");
  });
});

describe("permanent video deletion", () => {
  it("is allowed only for an unassigned video", () => {
    assert.deepEqual(deletionEligibility(ready, 0), { allowed: true });
    assert.deepEqual(deletionEligibility(ready, 1), { allowed: false, reason: "delete_assigned" });
    assert.deepEqual(deletionEligibility(ready, 3), { allowed: false, reason: "delete_assigned" }, "shared across projects");
  });

  it("is refused for an assigned video even when every project is a draft", () => {
    // The count covers every assignment, draft or published.
    assert.deepEqual(deletionEligibility({ status: "FAILED" }, 1), { allowed: false, reason: "delete_assigned" });
  });

  it("allows cleanup of failed, cancelled, processing, and previously failed deletions", () => {
    for (const status of ["FAILED", "CANCELLED", "PROCESSING", "DELETE_FAILED"] as const) {
      assert.deepEqual(deletionEligibility({ status }, 0), { allowed: true }, status);
    }
  });

  it("sends an upload in flight to cancellation, and refuses a second delete", () => {
    assert.deepEqual(deletionEligibility({ status: "UPLOAD_PENDING" }, 0), { allowed: false, reason: "delete_upload_in_progress" });
    assert.deepEqual(deletionEligibility({ status: "DELETING" }, 0), { allowed: false, reason: "delete_in_progress" });
  });

  it("rejects an impossible assignment count", () => {
    for (const count of [-1, 1.5, Number.NaN]) assert.throws(() => deletionEligibility(ready, count), RangeError);
  });
});
