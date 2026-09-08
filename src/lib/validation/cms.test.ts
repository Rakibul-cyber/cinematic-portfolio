import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categorySchema,
  projectSchema,
  settingsSchema,
  slugify,
} from "@/lib/validation/cms";
describe("CMS validation", () => {
  it("normalizes URL-safe slugs", () =>
    assert.equal(slugify("  Côte d'Azur Film  "), "cote-d-azur-film"));
  it("rejects unsafe slugs and invalid settings email", () => {
    assert.equal(
      categorySchema.safeParse({
        name: "A",
        slug: "../bad",
        description: "",
        sortOrder: 0,
        isActive: true,
      }).success,
      false,
    );
    assert.equal(
      settingsSchema.safeParse({
        studioName: "Studio",
        tagline: "",
        contactEmail: "bad",
        contactPhone: "",
        whatsappNumber: "",
        locationText: "",
        footerCopyright: "",
        defaultSeoTitle: "",
        defaultSeoDescription: "",
      }).success,
      false,
    );
  });
  it("validates project publication and media input", () => {
    const result = projectSchema.safeParse({
      title: "Test",
      slug: "test",
      summary: "Summary",
      description: "Description",
      clientName: "",
      location: "",
      projectDate: "",
      categoryId: "123e4567-e89b-12d3-a456-426614174000",
      status: "PUBLISHED",
      featured: false,
      sortOrder: 0,
      seoTitle: "",
      seoDescription: "",
      mediaIds: [],
    });
    assert.equal(result.success, true);
  });
});
