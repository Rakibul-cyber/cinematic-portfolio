"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  categorySchema,
  pageSchema,
  projectSchema,
  serviceSchema,
  settingsSchema,
  socialSchema,
  testimonialSchema,
} from "@/lib/validation/cms";
import { requireAdmin, requireUser } from "@/server/auth/session";
import {
  revalidatePublicContent,
  type PublicContentKind,
} from "@/server/public/revalidate";
import {
  deleteCategory,
  deleteProject,
  deleteSimple,
  saveCategory,
  savePage,
  saveProject,
  saveService,
  saveSettings,
  saveSocial,
  saveTestimonial,
  SlugConflictError,
} from "@/server/cms/service";

function values(form: FormData) {
  return Object.fromEntries(form.entries());
}
function fail(path: string, error: unknown): never {
  const message =
    error instanceof SlugConflictError
      ? error.message
      : error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Check the form fields.")
        : "The change could not be saved.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}
/**
 * Runs one CMS mutation, then refreshes both the admin page and the public
 * site before redirecting.
 *
 * `work` returns an optional redirect target rather than calling `redirect`
 * itself: `redirect` signals by throwing, so calling it inside the `try` would
 * be caught here and reported to the editor as a failed save.
 */
async function run(
  path: string,
  work: () => Promise<string | void>,
  publish?: { kind: PublicContentKind; slug?: string | null },
) {
  let target = path;

  try {
    target = (await work()) ?? path;
  } catch (error) {
    fail(path, error);
  }

  revalidatePath(path);
  if (publish) revalidatePublicContent(publish.kind, { slug: publish.slug });
  redirect(target);
}

export async function saveCategoryAction(form: FormData) {
  const actor = await requireUser("/admin/categories");
  const raw = values(form);
  await run(
    "/admin/categories",
    async () => {
      await saveCategory(
        categorySchema.parse({ ...raw, isActive: form.has("isActive") }),
        actor,
      );
    },
    { kind: "category" },
  );
}
export async function saveServiceAction(form: FormData) {
  const actor = await requireUser("/admin/services");
  const raw = values(form);
  await run(
    "/admin/services",
    async () => {
      await saveService(
        serviceSchema.parse({ ...raw, isActive: form.has("isActive") }),
        actor,
      );
    },
    { kind: "service" },
  );
}
export async function saveTestimonialAction(form: FormData) {
  const actor = await requireUser("/admin/testimonials");
  const raw = values(form);
  await run(
    "/admin/testimonials",
    async () => {
      await saveTestimonial(
        testimonialSchema.parse({ ...raw, isActive: form.has("isActive") }),
        actor,
      );
    },
    { kind: "testimonial" },
  );
}
export async function savePageAction(form: FormData) {
  const actor = await requireUser("/admin/pages");
  await run(
    "/admin/pages",
    async () => {
      await savePage(pageSchema.parse(values(form)), actor);
    },
    { kind: "page" },
  );
}
export async function saveSettingsAction(form: FormData) {
  const actor = await requireAdmin("/admin/settings");
  await run(
    "/admin/settings",
    async () => {
      await saveSettings(settingsSchema.parse(values(form)), actor);
    },
    { kind: "settings" },
  );
}
export async function saveSocialAction(form: FormData) {
  const actor = await requireUser("/admin/settings");
  const raw = values(form);
  await run(
    "/admin/settings",
    async () => {
      await saveSocial(
        socialSchema.parse({ ...raw, isActive: form.has("isActive") }),
        actor,
      );
    },
    { kind: "settings" },
  );
}
export async function saveProjectAction(form: FormData) {
  const actor = await requireUser("/admin/projects");
  const raw = values(form);
  const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
  const path = id ? `/admin/projects/${id}` : "/admin/projects/new";
  await run(
    path,
    async () => {
      const row = await saveProject(
        projectSchema.parse({
          ...raw,
          id,
          featured: form.has("featured"),
          mediaIds: form.getAll("mediaIds"),
        }),
        actor,
      );
      return `/admin/projects/${row.id}`;
    },
    { kind: "project", slug: typeof raw.slug === "string" ? raw.slug : null },
  );
}
export async function deleteAction(form: FormData) {
  const kind = z
    .enum(["category", "project", "service", "testimonial", "socialLink"])
    .parse(form.get("kind"));
  const id = z.string().uuid().parse(form.get("id"));
  const actor = await requireAdmin("/admin");
  const path =
    kind === "category"
      ? "/admin/categories"
      : kind === "project"
        ? "/admin/projects"
        : kind === "service"
          ? "/admin/services"
          : kind === "testimonial"
            ? "/admin/testimonials"
            : "/admin/settings";
  const publishKind: PublicContentKind =
    kind === "socialLink" ? "settings" : kind;

  await run(
    path,
    async () => {
      if (kind === "category") await deleteCategory(id, actor);
      else if (kind === "project") await deleteProject(id, actor);
      else await deleteSimple(kind, id, actor);
    },
    { kind: publishKind },
  );
}
