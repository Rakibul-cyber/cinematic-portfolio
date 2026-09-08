-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('R2');

-- CreateEnum
CREATE TYPE "MediaVariantName" AS ENUM ('THUMBNAIL', 'W640', 'W1280', 'W1920', 'MASTER');

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" TEXT,
    "caption" TEXT,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'R2',
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "blurDataUrl" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variant" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "variant" "MediaVariantName" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_objectKey_key" ON "media"("objectKey");

-- CreateIndex
CREATE INDEX "media_createdAt_idx" ON "media"("createdAt");

-- CreateIndex
CREATE INDEX "media_createdByUserId_idx" ON "media"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "media_variant_objectKey_key" ON "media_variant"("objectKey");

-- CreateIndex
CREATE INDEX "media_variant_mediaId_idx" ON "media_variant"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "media_variant_mediaId_variant_key" ON "media_variant"("mediaId", "variant");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variant" ADD CONSTRAINT "media_variant_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
