-- CreateEnum
CREATE TYPE "OutboxEventType" AS ENUM ('SLA_EVENT_SCHEDULED', 'SLA_EVENT_COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SLA_FIRST_RESPONSE_BREACHED';
ALTER TYPE "NotificationType" ADD VALUE 'SLA_RESOLUTION_BREACHED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "entityId" UUID,
ADD COLUMN     "entityType" TEXT;

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "slaEventId" UUID NOT NULL,
    "type" "OutboxEventType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(100),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_nextAttemptAt_createdAt_id_idx" ON "OutboxEvent"("processedAt", "nextAttemptAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "OutboxEvent_organizationId_idx" ON "OutboxEvent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_slaEventId_type_key" ON "OutboxEvent"("slaEventId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "SlaEvent_organizationId_id_key" ON "SlaEvent"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_slaEventId_fkey" FOREIGN KEY ("organizationId", "slaEventId") REFERENCES "SlaEvent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_nonnegative_attempts" CHECK ("attempts" >= 0);
