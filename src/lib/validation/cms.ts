import { z } from "zod";

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
});
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
  title: z.string().trim().min(1).max(160),
  slug,
  summary: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(15000),
  clientName: optional(160),
  location: optional(160),
  projectDate: z
    .string()
    .transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : null)),
  categoryId: z.string().uuid(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  featured: z.coerce.boolean(),
  sortOrder: order,
  seoTitle: optional(70),
  seoDescription: optional(160),
  mediaIds: z.array(z.string().uuid()).default([]),
});
