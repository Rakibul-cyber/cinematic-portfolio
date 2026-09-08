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
async function run(path: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    fail(path, error);
  }
  revalidatePath(path);
  redirect(path);
}

export async function saveCategoryAction(form: FormData) {
  const actor = await requireUser("/admin/categories");
  const raw = values(form);
  await run("/admin/categories", () =>
    saveCategory(
      categorySchema.parse({ ...raw, isActive: form.has("isActive") }),
      actor,
    ),
  );
}
export async function saveServiceAction(form: FormData) {
  const actor = await requireUser("/admin/services");
  const raw = values(form);
  await run("/admin/services", () =>
    saveService(
      serviceSchema.parse({ ...raw, isActive: form.has("isActive") }),
      actor,
    ),
  );
}
export async function saveTestimonialAction(form: FormData) {
  const actor = await requireUser("/admin/testimonials");
  const raw = values(form);
  await run("/admin/testimonials", () =>
    saveTestimonial(
      testimonialSchema.parse({ ...raw, isActive: form.has("isActive") }),
      actor,
    ),
  );
}
export async function savePageAction(form: FormData) {
  const actor = await requireUser("/admin/pages");
  await run("/admin/pages", () =>
    savePage(pageSchema.parse(values(form)), actor),
  );
}
export async function saveSettingsAction(form: FormData) {
  const actor = await requireAdmin("/admin/settings");
  await run("/admin/settings", () =>
    saveSettings(settingsSchema.parse(values(form)), actor),
  );
}
export async function saveSocialAction(form: FormData) {
  const actor = await requireUser("/admin/settings");
  const raw = values(form);
  await run("/admin/settings", () =>
    saveSocial(
      socialSchema.parse({ ...raw, isActive: form.has("isActive") }),
      actor,
    ),
  );
}
export async function saveProjectAction(form: FormData) {
  const actor = await requireUser("/admin/projects");
  const raw = values(form);
  const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
  const path = id ? `/admin/projects/${id}` : "/admin/projects/new";
  await run(path, async () => {
    const row = await saveProject(
      projectSchema.parse({
        ...raw,
        id,
        featured: form.has("featured"),
        mediaIds: form.getAll("mediaIds"),
      }),
      actor,
    );
    redirect(`/admin/projects/${row.id}`);
  });
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
  await run(path, () =>
    kind === "category"
      ? deleteCategory(id, actor)
      : kind === "project"
        ? deleteProject(id, actor)
        : deleteSimple(kind, id, actor),
  );
}
