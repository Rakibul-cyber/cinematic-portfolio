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
import { describeValidationError, type AdminFormState } from "@/lib/admin/form-state";
import { PROJECT_VIDEO_SECTION_FIELD } from "@/lib/cms/project-videos";
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
  ProjectConflictError,
  ProjectVideoAssignmentError,
  ReferencedCategoryError,
  SlugConflictError,
} from "@/server/cms/service";

function values(form: FormData) {
  return Object.fromEntries(form.entries());
}
function failure(error: unknown): NonNullable<AdminFormState> {
  if (error instanceof SlugConflictError) return { error: error.message, field: "slug" };
  if (error instanceof ProjectConflictError) return { error: error.message };
  if (error instanceof ProjectVideoAssignmentError) return { error: error.message };
  if (error instanceof ReferencedCategoryError) return { error: error.message };
  if (error instanceof z.ZodError) return describeValidationError(error);
  return { error: "The change could not be saved." };
}
function fail(path: string, error: unknown): never {
  redirect(`${path}?error=${encodeURIComponent(failure(error).error)}`);
}
/**
 * Runs one CMS save submitted through `AdminForm`.
 *
 * A failure is returned as form state rather than redirected, so the editor's
 * input survives in the browser. Success refreshes the admin page and the
 * public site and redirects, exactly as `run` does.
 */
async function save(
  path: string,
  work: () => Promise<string | void>,
  publish?: { kind: PublicContentKind; slug?: string | null },
): Promise<AdminFormState> {
  let target = path;

  try {
    target = (await work()) ?? path;
  } catch (error) {
    return failure(error);
  }

  revalidatePath(path);
  if (publish) revalidatePublicContent(publish.kind, { slug: publish.slug });
  redirect(target);
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

export async function saveCategoryAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireUser("/admin/categories");
  const raw = values(form);
  return save(
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
export async function saveServiceAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireUser("/admin/services");
  const raw = values(form);
  return save(
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
export async function saveTestimonialAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireUser("/admin/testimonials");
  const raw = values(form);
  return save(
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
export async function savePageAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireUser("/admin/pages");
  return save(
    "/admin/pages",
    async () => {
      await savePage(pageSchema.parse(values(form)), actor);
    },
    { kind: "page" },
  );
}
export async function saveSettingsAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireAdmin("/admin/settings");
  return save(
    "/admin/settings",
    async () => {
      await saveSettings(settingsSchema.parse(values(form)), actor);
    },
    { kind: "settings" },
  );
}
export async function saveSocialAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireAdmin("/admin/settings");
  const raw = values(form);
  return save(
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
export async function saveProjectAction(
  _state: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const actor = await requireUser("/admin/projects");
  const raw = values(form);
  const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
  const path = id ? `/admin/projects/${id}` : "/admin/projects/new";
  return save(
    path,
    async () => {
      const row = await saveProject(
        projectSchema.parse({
          ...raw,
          id,
          featured: form.has("featured"),
          mediaIds: form.getAll("mediaIds"),
          // Present only when the form rendered the video section (ADMIN or
          // SUPER_ADMIN); the service ignores it for any other role.
          videoIds: form.has(PROJECT_VIDEO_SECTION_FIELD)
            ? form.getAll("videoIds")
            : undefined,
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
