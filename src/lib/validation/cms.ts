import { z } from "zod";

import { isValidVideoId, VIDEO_PROVIDERS } from "@/lib/video";
import { MAX_VIDEO_URL_LENGTH, parseEmbeddableVideoUrl } from "@/lib/video-url";

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/** A new project's slug when the editor leaves it empty. */
export function defaultProjectSlug(title: string): string {
  // `slugify` can cut a word in half at 100 characters and leave a hyphen.
  return slugify(title).replace(/-+$/, "") || "project";
}

/**
 * The project form's submitted values, ready for `projectSchema`.
 *
 * The publish checkbox is sent only when ticked, so its absence means draft.
 * An empty slug on a new project is generated from the title; an existing
 * project's slug is never generated, so an emptied one is reported instead.
 */
export function projectFormValues(form: FormData) {
  const raw = Object.fromEntries(form.entries());
  const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  return {
    ...raw,
    id,
    slug: slug || (id ? "" : defaultProjectSlug(title)),
    status: form.get("status") === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    featured: form.has("featured"),
    mediaIds: form.getAll("mediaIds"),
  };
}

const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and hyphens only.",
  );
const order = z.coerce.number().int().min(-10_000).max(10_000).default(0);
/**
 * Provider-neutral video input.
 *
 * Only a provider and that provider's own identifier are accepted; iframe
 * markup, embed scripts, and full URLs are rejected outright. The pair must be
 * complete and the identifier must match the provider's shape, so a half-filled
 * form cannot store a video reference the public player would fail to build.
 */
const videoProvider = z
  .enum(VIDEO_PROVIDERS)
  .or(z.literal(""))
  .default("")
  .transform((value) => value || null);

const videoIdentifier = z
  .string()
  .trim()
  .max(64)
  .default("")
  .transform((value) => value || null);

/** Optional free text that may be missing from the form entirely. */
const videoTitle = z
  .string()
  .trim()
  .max(160)
  .default("")
  .transform((value) => value || null);

function checkVideoPair(
  provider: (typeof VIDEO_PROVIDERS)[number] | null,
  id: string | null,
  ctx: z.RefinementCtx,
  path: string,
) {
  if (!provider && !id) return;

  if (!provider || !id) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: "Set both a video provider and a video ID, or leave both empty.",
    });
    return;
  }

  if (!isValidVideoId(provider, id)) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message:
        "Enter the provider's video ID only — not a URL or embed code.",
    });
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  slug,
  description: optional(1000),
  sortOrder: order,
  isActive: z.coerce.boolean(),
});
export const serviceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  slug,
  shortDescription: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(5000),
  priceLabel: optional(100),
  sortOrder: order,
  isActive: z.coerce.boolean(),
});
export const testimonialSchema = z.object({
  id: z.string().uuid().optional(),
  quote: z.string().trim().min(1).max(2000),
  authorName: z.string().trim().min(1).max(120),
  authorRole: optional(120),
  company: optional(120),
  projectName: optional(120),
  sortOrder: order,
  isActive: z.coerce.boolean(),
});
export const pageSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.enum(["about", "contact", "services"]),
  title: z.string().trim().min(1).max(160),
  eyebrow: optional(100),
  body: z.string().trim().min(1).max(10000),
  seoTitle: optional(70),
  seoDescription: optional(160),
});
export const settingsSchema = z.object({
  studioName: z.string().trim().min(1).max(120),
  tagline: optional(200),
  contactEmail: z
    .union([z.literal(""), z.string().email()])
    .transform((v) => v || null),
  contactPhone: optional(50),
  whatsappNumber: optional(50),
  locationText: optional(200),
  footerCopyright: optional(200),
  defaultSeoTitle: optional(70),
  defaultSeoDescription: optional(160),
  showreelProvider: videoProvider,
  showreelVideoId: videoIdentifier,
  showreelTitle: videoTitle,
}).superRefine((value, ctx) =>
  checkVideoPair(
    value.showreelProvider,
    value.showreelVideoId,
    ctx,
    "showreelVideoId",
  ),
);
export const socialSchema = z.object({
  id: z.string().uuid().optional(),
  platform: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(100),
  url: z.string().url().max(500),
  sortOrder: order,
  isActive: z.coerce.boolean(),
});
export const projectSchema = z.object({
  id: z.string().uuid().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
  title: z.string().trim().min(1).max(160),
  slug,
  // Optional: an empty short description renders nothing on the public site.
  summary: z.string().trim().max(500).default(""),
  // Optional: an empty description renders no paragraphs on the public page.
  description: z.string().trim().max(15000).default(""),
  clientName: optional(160),
  location: optional(160),
  projectDate: z
    .string()
    .transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : null)),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  featured: z.coerce.boolean(),
  sortOrder: order,
  seoTitle: optional(70),
  seoDescription: optional(160),
  // A pasted YouTube, Vimeo, or Google Drive link. Only the provider and its
  // video ID are stored (see the transform below); the link itself never is.
  videoUrl: z.string().trim().max(MAX_VIDEO_URL_LENGTH).default(""),
  videoTitle,
  mediaIds: z.array(z.string().uuid()).default([]),
}).superRefine((value, ctx) => {
  if (value.videoUrl) {
    const video = parseEmbeddableVideoUrl(value.videoUrl);
    if (!video.ok) ctx.addIssue({ code: "custom", path: ["videoUrl"], message: video.message });
  }

  if (value.id && !value.expectedUpdatedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["expectedUpdatedAt"],
      message: "Reload the project before saving.",
    });
  }

  if (new Set(value.mediaIds).size !== value.mediaIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["mediaIds"],
      message: "A media item can only be attached once.",
    });
  }
}).transform(({ videoUrl, ...value }) => {
  const parsed = videoUrl ? parseEmbeddableVideoUrl(videoUrl) : null;
  const video = parsed?.ok ? parsed.value : null;
  return {
    ...value,
    videoProvider: video?.provider ?? null,
    videoId: video?.videoId ?? null,
    // A title without a video would never be shown.
    videoTitle: video ? value.videoTitle : null,
  };
});
