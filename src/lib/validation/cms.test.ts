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

  it("rejects duplicate and invalid project media ids", () => {
    const base = {
      title: "Test",
      slug: "test",
      summary: "Summary",
      description: "Description",
      clientName: "",
      location: "",
      projectDate: "",
      categoryId: "123e4567-e89b-12d3-a456-426614174000",
      status: "DRAFT",
      featured: false,
      sortOrder: 0,
      seoTitle: "",
      seoDescription: "",
    };
    const id = "123e4567-e89b-12d3-a456-426614174001";

    assert.equal(
      projectSchema.safeParse({ ...base, mediaIds: [id, id] }).success,
      false,
    );
    assert.equal(
      projectSchema.safeParse({ ...base, mediaIds: ["not-a-media-id"] }).success,
      false,
    );
  });

  it("requires an edit version while leaving new project publication unchanged", () => {
    const edit = {
      id: "123e4567-e89b-12d3-a456-426614174002",
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
    };

    assert.equal(projectSchema.safeParse(edit).success, false);
    const parsed = projectSchema.safeParse({
      ...edit,
      expectedUpdatedAt: "2026-10-23T12:00:00.000Z",
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.status, "PUBLISHED");
      assert.equal(parsed.data.expectedUpdatedAt?.toISOString(), "2026-10-23T12:00:00.000Z");
    }
  });
});
