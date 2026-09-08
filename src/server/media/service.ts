import "server-only";
import { MediaVariantName } from "@/generated/prisma/enums";
import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import type { AdminUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { createMediaKeyPrefix, objectKey } from "@/server/media/keys";
import { processImage } from "@/server/media/processing";
import { deleteR2Objects, getR2, putR2Object } from "@/server/media/r2";

const variantEnums = { thumbnail: MediaVariantName.THUMBNAIL, w640: MediaVariantName.W640, w1280: MediaVariantName.W1280, w1920: MediaVariantName.W1920, master: MediaVariantName.MASTER } as const;

export async function uploadMedia(file: File, altText: string | null, actor: AdminUser) {
  const image = await processImage(Buffer.from(await file.arrayBuffer()));
  const prefix = createMediaKeyPrefix();
  const outputs = [image.master, ...image.variants].map((variant) => ({ ...variant, key: objectKey(prefix, `${variant.name}.webp`) }));
  const uploaded: string[] = [];
  try {
    for (const output of outputs) { await putR2Object(output.key, output.buffer); uploaded.push(output.key); }
    const { config } = getR2();
    const master = outputs.find((v) => v.name === "master")!;
    const media = await prisma.media.create({ data: { originalName: file.name.slice(0, 255), mimeType: master.mimeType, sizeBytes: master.buffer.length, width: master.width, height: master.height, altText: altText || null, bucket: config.R2_BUCKET_NAME, objectKey: master.key, blurDataUrl: image.blurDataUrl, createdByUserId: actor.id, variants: { create: outputs.filter((v) => v.name !== "master").map((v) => ({ variant: variantEnums[v.name], width: v.width, height: v.height, mimeType: v.mimeType, sizeBytes: v.buffer.length, objectKey: v.key })) } }, include: { variants: true } });
    await recordAuditLog({ action: AuditAction.MediaUploaded, entityType: AuditEntityType.Media, entityId: media.id, actorUserId: actor.id, actorEmail: actor.email, metadata: { width: media.width, height: media.height, variantCount: media.variants.length } });
    return media;
  } catch (error) { try { await deleteR2Objects(uploaded); } catch { console.error("[media] Failed to clean up an incomplete upload."); } throw error; }
}

export async function deleteMedia(id: string, actor: AdminUser): Promise<void> {
  const media = await prisma.media.findUnique({ where: { id }, include: { variants: true } });
  if (!media) return;
  const references = await prisma.projectMedia.count({ where: { mediaId: id } });
  if (references > 0) throw new MediaInUseError();
  const keys = [media.objectKey, ...media.variants.map((v) => v.objectKey)];
  await deleteR2Objects(keys);
  await prisma.media.delete({ where: { id } });
  await recordAuditLog({ action: AuditAction.MediaDeleted, entityType: AuditEntityType.Media, entityId: id, actorUserId: actor.id, actorEmail: actor.email, metadata: { objectCount: keys.length } });
}

export class MediaInUseError extends Error {
  constructor() { super("This image is assigned to a project. Remove it from the project before deleting it."); this.name = "MediaInUseError"; }
}

export async function updateMediaMetadata(
  id: string,
  input: { altText: string | null; caption: string | null },
  actor: AdminUser,
): Promise<void> {
  const media = await prisma.media.update({ where: { id }, data: input, select: { id: true } });
  await recordAuditLog({
    action: AuditAction.MediaUpdated,
    entityType: AuditEntityType.Media,
    entityId: media.id,
    actorUserId: actor.id,
    actorEmail: actor.email,
    metadata: { fields: ["altText", "caption"] },
  });
}
