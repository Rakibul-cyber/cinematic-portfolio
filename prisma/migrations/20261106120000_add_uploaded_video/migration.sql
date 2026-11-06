-- P3-11C: uploaded video (Mux) and project assignments. Additive only: one enum
-- and two new tables; no existing table, column, or constraint changes.
-- Generated offline with `prisma migrate diff --from-schema --to-schema`.
-- NOT APPLIED to any database (database integration BLOCKED by P4-03).

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOAD_PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED', 'DELETING', 'DELETE_FAILED');

-- CreateTable
CREATE TABLE "video" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "declaredSizeBytes" BIGINT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "uploaderId" TEXT NOT NULL,
    "muxUploadId" TEXT NOT NULL,
    "muxAssetId" TEXT,
    "playbackId" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "maxResolution" TEXT,
    "failureCode" TEXT,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_video" (
    "projectId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_video_pkey" PRIMARY KEY ("projectId","videoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_muxUploadId_key" ON "video"("muxUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "video_muxAssetId_key" ON "video"("muxAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "video_playbackId_key" ON "video"("playbackId");

-- CreateIndex
CREATE INDEX "video_uploaderId_status_uploadExpiresAt_idx" ON "video"("uploaderId", "status", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "video_status_idx" ON "video"("status");

-- CreateIndex
CREATE INDEX "project_video_projectId_sortOrder_idx" ON "project_video"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_video_videoId_idx" ON "project_video"("videoId");

-- AddForeignKey
ALTER TABLE "video" ADD CONSTRAINT "video_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_video" ADD CONSTRAINT "project_video_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_video" ADD CONSTRAINT "project_video_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
