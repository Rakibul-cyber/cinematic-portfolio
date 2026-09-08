"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_MEDIA_PATH } from "@/lib/admin-routes";
import { requireUser } from "@/server/auth/session";
import { deleteMedia, updateMediaMetadata } from "@/server/media/service";

export async function deleteMediaAction(formData: FormData): Promise<void> {
  const actor = await requireUser(ADMIN_MEDIA_PATH);
  const id = z.string().uuid().parse(formData.get("id"));
  await deleteMedia(id, actor);
  revalidatePath(ADMIN_MEDIA_PATH);
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
}
