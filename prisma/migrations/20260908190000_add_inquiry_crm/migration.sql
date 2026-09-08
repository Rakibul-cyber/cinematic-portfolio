CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'DISCUSSION', 'QUOTE_SENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "customer" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL, "phone" TEXT, "whatsapp" TEXT,
  "company" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_normalizedEmail_key" ON "customer"("normalizedEmail");
CREATE INDEX "customer_updatedAt_idx" ON "customer"("updatedAt");

CREATE TABLE "inquiry" (
  "id" TEXT NOT NULL, "submissionToken" TEXT NOT NULL, "customerId" TEXT NOT NULL,
  "serviceId" TEXT, "serviceNameSnapshot" TEXT, "nameSnapshot" TEXT NOT NULL,
  "emailSnapshot" TEXT NOT NULL, "phoneSnapshot" TEXT, "whatsappSnapshot" TEXT,
  "companySnapshot" TEXT, "projectType" TEXT NOT NULL, "projectDate" DATE,
  "location" TEXT, "budgetLabel" TEXT, "message" TEXT NOT NULL,
  "referralSource" TEXT, "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inquiry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inquiry_submissionToken_key" ON "inquiry"("submissionToken");
CREATE INDEX "inquiry_status_createdAt_idx" ON "inquiry"("status", "createdAt");
CREATE INDEX "inquiry_customerId_createdAt_idx" ON "inquiry"("customerId", "createdAt");
CREATE INDEX "inquiry_serviceId_idx" ON "inquiry"("serviceId");
CREATE INDEX "inquiry_createdAt_idx" ON "inquiry"("createdAt");

CREATE TABLE "inquiry_status_history" (
  "id" TEXT NOT NULL, "inquiryId" TEXT NOT NULL, "fromStatus" "InquiryStatus",
  "toStatus" "InquiryStatus" NOT NULL, "changedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inquiry_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inquiry_status_history_inquiryId_createdAt_idx" ON "inquiry_status_history"("inquiryId", "createdAt");

CREATE TABLE "customer_note" (
  "id" TEXT NOT NULL, "customerId" TEXT NOT NULL, "authorUserId" TEXT,
  "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_note_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_note_customerId_createdAt_idx" ON "customer_note"("customerId", "createdAt");

ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inquiry_status_history" ADD CONSTRAINT "inquiry_status_history_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inquiry_status_history" ADD CONSTRAINT "inquiry_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
