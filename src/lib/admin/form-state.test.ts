import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeValidationError } from "@/lib/admin/form-state";
import { categorySchema, pageSchema, projectSchema, settingsSchema, socialSchema } from "@/lib/validation/cms";

/** The real admin schemas, so a schema change that alters the reported field or message shows up here. */
function failureOf(result: { success: boolean; error?: unknown }) {
  assert.equal(result.success, false);
  return describeValidationError(result.error as Parameters<typeof describeValidationError>[0]);
}

const category = { name: "Weddings", slug: "weddings", description: "", sortOrder: "0", isActive: true };
const page = { key: "services", title: "Services", eyebrow: "", body: "Body", seoTitle: "", seoDescription: "" };
const project = { title: "T", slug: "t", summary: "S", description: "D", clientName: "", location: "", projectDate: "", categoryId: "00000000-0000-4000-8000-000000000001", status: "DRAFT", featured: false, sortOrder: "0", seoTitle: "", seoDescription: "", mediaIds: [] };
const settings = { studioName: "Studio", tagline: "", contactEmail: "", contactPhone: "", whatsappNumber: "", locationText: "", footerCopyright: "", defaultSeoTitle: "", defaultSeoDescription: "" };

describe("admin validation messages", () => {
  it("keeps the schema's own slug message and names the slug field", () => {
    assert.deepEqual(failureOf(projectSchema.safeParse({ ...project, slug: "Bad Slug!" })), { error: "Use lowercase letters, numbers, and hyphens only.", field: "slug" });
  });

  it("states a text limit plainly for the field that exceeds it", () => {
    assert.deepEqual(failureOf(pageSchema.safeParse({ ...page, seoTitle: "x".repeat(80) })), { error: "Use 70 characters or fewer.", field: "seoTitle" });
  });

  it("explains a required field and an out-of-range or non-numeric order", () => {
    assert.deepEqual(failureOf(categorySchema.safeParse({ ...category, name: "" })), { error: "This field is required.", field: "name" });
    assert.deepEqual(failureOf(categorySchema.safeParse({ ...category, sortOrder: "99999" })), { error: "Use a number no greater than 10000.", field: "sortOrder" });
    assert.deepEqual(failureOf(categorySchema.safeParse({ ...category, sortOrder: "abc" })), { error: "Enter a whole number.", field: "sortOrder" });
  });

  it("replaces Zod's format defaults for email, URL and option fields", () => {
    assert.deepEqual(failureOf(settingsSchema.safeParse({ ...settings, contactEmail: "nope" })), { error: "Enter a valid email address.", field: "contactEmail" });
    assert.deepEqual(failureOf(socialSchema.safeParse({ platform: "P", label: "L", url: "nope", sortOrder: "0", isActive: true })), { error: "Enter a full URL, including https://.", field: "url" });
    assert.deepEqual(failureOf(projectSchema.safeParse({ ...project, categoryId: "" })), { error: "Choose one of the listed options.", field: "categoryId" });
    assert.deepEqual(failureOf(projectSchema.safeParse({ ...project, status: "LIVE" })), { error: "Choose one of the listed options.", field: "status" });
  });

  it("keeps cross-field messages on the field the schema points at", () => {
    assert.deepEqual(failureOf(projectSchema.safeParse({ ...project, videoUrl: "https://example.com/film.mp4" })), { error: "Only YouTube, Vimeo, and Google Drive links are supported.", field: "videoUrl" });
    assert.deepEqual(failureOf(settingsSchema.safeParse({ ...settings, showreelProvider: "YOUTUBE", showreelVideoId: "https://youtu.be/x" })), { error: "Enter the provider's video ID only — not a URL or embed code.", field: "showreelVideoId" });
  });

  it("never returns Zod's technical wording", () => {
    for (const result of [pageSchema.safeParse({ key: "about" }), categorySchema.safeParse({}), projectSchema.safeParse({})]) {
      assert.doesNotMatch(failureOf(result).error, /Invalid input|expected|received|Too (big|small)|UUID/);
    }
  });
});
