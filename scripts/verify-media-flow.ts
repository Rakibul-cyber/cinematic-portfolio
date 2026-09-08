import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { deleteMedia, updateMediaMetadata, uploadMedia } from "@/server/media/service";
import { mediaUrl, r2ObjectExists } from "@/server/media/r2";

async function main() {
 const existingActor = await prisma.user.findFirst({ select: { id: true, name: true, email: true, role: true } });
 const temporaryActorId = existingActor ? undefined : randomUUID();
 const actor = existingActor ?? await prisma.user.create({ data: { id: temporaryActorId!, name: "Phase 3 verifier", email: `phase-3-verifier-${temporaryActorId}@invalid.example`, role: AdminRole.EDITOR }, select: { id: true, name: true, email: true, role: true } });
 const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#786452" } }).withMetadata({ exif: { IFD0: { Artist: "verification-only" } } }).jpeg().toBuffer();
 let mediaId: string | undefined;
 try {
  const media = await uploadMedia(new File([source], "phase-3-verification.jpg", { type: "image/jpeg" }), "Phase 3 verification image", actor);
  mediaId = media.id;
  const keys = [media.objectKey, ...media.variants.map((variant) => variant.objectKey)];
  assert.ok(media.variants.length >= 2);
  assert.ok((await Promise.all(keys.map(r2ObjectExists))).every(Boolean));
  const thumbnail = media.variants.find((variant) => variant.variant === "THUMBNAIL");
  assert.ok(thumbnail);
  const delivery = await fetch(mediaUrl(thumbnail.objectKey));
  assert.equal(delivery.status, 200);
  assert.match(delivery.headers.get("content-type") ?? "", /^image\/webp/);
  assert.ok(await prisma.media.findUnique({ where: { id: media.id } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "media.uploaded", entityId: media.id } }));
  await updateMediaMetadata(media.id, { altText: "Updated verification alt text", caption: null }, actor);
  assert.equal((await prisma.media.findUnique({ where: { id: media.id } }))?.altText, "Updated verification alt text");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "media.updated", entityId: media.id } }));
  await deleteMedia(media.id, actor);
  mediaId = undefined;
  assert.ok((await Promise.all(keys.map(r2ObjectExists))).every((exists) => !exists));
  assert.equal(await prisma.media.findUnique({ where: { id: media.id } }), null);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "media.deleted", entityId: media.id } }));
  console.log("Live media verification passed: processed upload, R2 objects, database row, audit events, and deletion cleanup.");
 } finally {
  if (mediaId) {
    const leftover = await prisma.media.findUnique({ where: { id: mediaId } });
    if (leftover) await deleteMedia(mediaId, actor);
  }
  if (temporaryActorId) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: temporaryActorId } });
    await prisma.user.delete({ where: { id: temporaryActorId } });
  }
  await prisma.$disconnect();
 }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Live media verification failed."); process.exitCode = 1; });
