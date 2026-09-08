-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('YOUTUBE', 'VIMEO', 'EXTERNAL');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "videoId" TEXT,
ADD COLUMN     "videoProvider" "VideoProvider",
ADD COLUMN     "videoTitle" TEXT;

-- AlterTable
ALTER TABLE "site_setting" ADD COLUMN     "showreelProvider" "VideoProvider",
ADD COLUMN     "showreelTitle" TEXT,
ADD COLUMN     "showreelVideoId" TEXT;
