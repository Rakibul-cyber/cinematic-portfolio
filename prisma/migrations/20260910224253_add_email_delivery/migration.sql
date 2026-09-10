-- CreateEnum
CREATE TYPE "EmailDeliveryType" AS ENUM ('INQUIRY_ADMIN_NOTIFICATION', 'INQUIRY_CUSTOMER_ACKNOWLEDGMENT');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PROCESSING', 'ACCEPTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "email_delivery" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "type" "EmailDeliveryType" NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PROCESSING',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_delivery_status_updatedAt_idx" ON "email_delivery"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_delivery_inquiryId_type_key" ON "email_delivery"("inquiryId", "type");

-- AddForeignKey
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
