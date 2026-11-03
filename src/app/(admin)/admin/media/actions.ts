"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminFormState } from "@/lib/admin/form-state";
import { ADMIN_MEDIA_PATH } from "@/lib/admin-routes";
import { requireAdmin, requireUser } from "@/server/auth/session";
import { deleteMedia, MediaInUseError, updateMediaMetadata } from "@/server/media/service";
import { revalidatePublicContent } from "@/server/public/revalidate";

/**
 * Deletes one image, submitted through `AdminForm`. Permanent deletion is a
 * destructive action, so it requires ADMIN or SUPER_ADMIN (ADR 0004); an EDITOR
 * is refused here even if the control is bypassed. An image still assigned to
 * a project is an expected refusal, returned as form state so the message
 * appears beside that image; any other failure still throws.
 */
export async function deleteMediaAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAdmin(ADMIN_MEDIA_PATH);
  const id = z.string().uuid().parse(formData.get("id"));
  try {
    await deleteMedia(id, actor);
  } catch (error) {
    if (error instanceof MediaInUseError) return { error: error.message };
    throw error;
  }
  revalidatePath(ADMIN_MEDIA_PATH);
  revalidatePublicContent("media");
  return null;
}

const metadataSchema = z.object({
  id: z.string().uuid(),
  altText: z.string().trim().max(500),
  caption: z.string().trim().max(2_000),
});

export async function updateMediaMetadataAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireUser(ADMIN_MEDIA_PATH);
  const input = metadataSchema.parse({
    id: formData.get("id"),
    altText: formData.get("altText"),
    caption: formData.get("caption"),
  });
  await updateMediaMetadata(
    input.id,
    { altText: input.altText || null, caption: input.caption || null },
    actor,
  );
  revalidatePath(ADMIN_MEDIA_PATH);
  // Alt text and captions are rendered publicly, so a metadata edit must
  // refresh every project page that shows this image.
  revalidatePublicContent("media");
}
