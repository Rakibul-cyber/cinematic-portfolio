import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categorySchema,
  defaultProjectSlug,
  projectFormValues,
  projectSchema,
  settingsSchema,
  slugify,
} from "@/lib/validation/cms";

const CATEGORY = "123e4567-e89b-12d3-a456-426614174000";
const PROJECT = "223e4567-e89b-12d3-a456-426614174000";
function projectForm(entries: [string, string][]) {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return form;
}

describe("simplified project form", () => {
  it("generates a new project's slug from the title", () => {
    const values = projectFormValues(projectForm([["title", "Côte d'Azur Wedding Film"], ["slug", ""], ["summary", "S"]]));
    assert.equal(values.slug, "cote-d-azur-wedding-film");
    assert.equal(values.id, undefined);
  });

  it("keeps a slug the editor typed, and never generates one for an existing project", () => {
    assert.equal(projectFormValues(projectForm([["title", "New title"], ["slug", "chosen-slug"]])).slug, "chosen-slug");
    const edited = projectFormValues(projectForm([["id", PROJECT], ["title", "Renamed project"], ["slug", "original-slug"]]));
    assert.equal(edited.slug, "original-slug");
    const emptied = projectFormValues(projectForm([["id", PROJECT], ["title", "Renamed project"], ["slug", ""]]));
    assert.equal(emptied.slug, "", "an emptied slug is reported, not regenerated");
    assert.equal(projectSchema.safeParse({ ...emptied, summary: "S", projectDate: "", expectedUpdatedAt: new Date().toISOString() }).success, false);
  });

  it("falls back when a title has no URL-safe characters, and never ends a slug with a hyphen", () => {
    assert.equal(defaultProjectSlug("日本の結婚式"), "project");
    assert.equal(defaultProjectSlug(`${"a".repeat(99)} b`), "a".repeat(99));
  });

  it("maps the publish checkbox to the status, and missing checkboxes to false", () => {
    assert.equal(projectFormValues(projectForm([["status", "PUBLISHED"]])).status, "PUBLISHED");
    assert.equal(projectFormValues(projectForm([])).status, "DRAFT");
    assert.equal(projectFormValues(projectForm([["status", "anything"]])).status, "DRAFT");
    assert.equal(projectFormValues(projectForm([])).featured, false);
    assert.deepEqual(projectFormValues(projectForm([["mediaIds", "a"], ["mediaIds", "b"]])).mediaIds, ["a", "b"]);
  });

  it("saves a project from the visible fields only, storing just provider, ID and title", () => {
    const form = projectForm([
      ["title", "Brand Film"], ["slug", ""], ["summary", "A short film."],
      ["videoUrl", "https://youtu.be/dQw4w9WgXcQ"], ["videoTitle", ""],
      ["description", ""], ["clientName", ""], ["location", ""], ["projectDate", ""], ["sortOrder", "0"], ["seoTitle", ""], ["seoDescription", ""],
    ]);
    const parsed = projectSchema.parse(projectFormValues(form));
    assert.equal(parsed.slug, "brand-film");
    assert.equal(parsed.status, "DRAFT");
    assert.equal(parsed.description, "");
    assert.equal(parsed.videoProvider, "YOUTUBE");
    assert.equal(parsed.videoId, "dQw4w9WgXcQ");
    assert.equal(parsed.videoTitle, null, "the public player falls back to the project title");
    assert.ok(!("videoUrl" in parsed));
  });

  it("keeps the advanced values and a saved video title on save", () => {
    const form = projectForm([
      ["id", PROJECT], ["expectedUpdatedAt", "2026-11-07T10:00:00.000Z"],
      ["title", "Brand Film"], ["slug", "kept-slug"], ["summary", "A short film."], ["status", "PUBLISHED"],
      ["videoUrl", "https://vimeo.com/76979871"], ["videoTitle", "Director's cut"],
      ["description", "Long text."], ["clientName", "Client"], ["location", "Berlin"], ["projectDate", "2026-05-01"], ["sortOrder", "3"], ["featured", "on"], ["seoTitle", "SEO"], ["seoDescription", "SEO text"],
    ]);
    const parsed = projectSchema.parse(projectFormValues(form));
    assert.equal(parsed.slug, "kept-slug");
    assert.equal(parsed.status, "PUBLISHED");
    assert.equal(parsed.featured, true);
    assert.equal(parsed.sortOrder, 3);
    assert.equal(parsed.clientName, "Client");
    assert.equal(parsed.location, "Berlin");
    assert.equal(parsed.projectDate?.toISOString(), "2026-05-01T00:00:00.000Z");
    assert.equal(parsed.seoTitle, "SEO");
    assert.equal(parsed.seoDescription, "SEO text");
    assert.equal(parsed.description, "Long text.");
    assert.equal(parsed.videoTitle, "Director's cut");
  });

  // What a new project's form submits with every advanced field left empty.
  const NEW: [string, string][] = [
    ["title", "T"], ["slug", ""], ["summary", "S"], ["videoUrl", ""], ["videoTitle", ""],
    ["description", ""], ["clientName", ""], ["location", ""], ["projectDate", ""], ["sortOrder", "0"], ["seoTitle", ""], ["seoDescription", ""],
  ];
  const EDIT: [string, string][] = [
    ["id", PROJECT], ["expectedUpdatedAt", "2026-11-07T10:00:00.000Z"], ["slug", "kept-slug"],
    ...NEW.filter(([k]) => k !== "slug"),
  ];

  it("still refuses an invalid video link on the server", () => {
    assert.equal(projectSchema.safeParse(projectFormValues(projectForm(NEW))).success, true);
    const result = projectSchema.safeParse(projectFormValues(projectForm(NEW.map(([k, v]) => [k, k === "videoUrl" ? "https://example.com/film.mp4" : v]))));
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path[0]), ["videoUrl"]);
  });

  it("requires only the title (it names the page and makes the slug)", () => {
    const result = projectSchema.safeParse(projectFormValues(projectForm(NEW.map(([k, v]) => [k, k === "title" ? "" : v]))));
    assert.deepEqual(result.error?.issues.map((issue) => issue.path[0]), ["title"]);
  });

  it("saves a project with only a title: no description, video, image or category", () => {
    const parsed = projectSchema.parse(projectFormValues(projectForm(NEW.map(([k, v]) => [k, k === "summary" ? "" : v]))));
    assert.equal(parsed.summary, "");
    assert.equal(parsed.videoProvider, null);
    assert.deepEqual(parsed.mediaIds, []);
  });

  it("creates and edits a project without any category, writing none", () => {
    for (const entries of [NEW, EDIT]) {
      const parsed = projectSchema.parse(projectFormValues(projectForm(entries)));
      assert.ok(!("categoryId" in parsed), "the save never writes a category, so a saved one is kept");
    }
    assert.equal(projectSchema.parse(projectFormValues(projectForm(EDIT))).id, PROJECT);
  });

  it("ignores a categoryId posted by an old form instead of writing it", () => {
    const parsed = projectSchema.parse(projectFormValues(projectForm([...EDIT, ["categoryId", CATEGORY]])));
    assert.ok(!("categoryId" in parsed));
  });
});

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
