-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxEventType" ADD VALUE 'TICKET_CREATED';
ALTER TYPE "OutboxEventType" ADD VALUE 'TICKET_UPDATED';
ALTER TYPE "OutboxEventType" ADD VALUE 'TICKET_ASSIGNED';
ALTER TYPE "OutboxEventType" ADD VALUE 'TICKET_STATUS_CHANGED';
ALTER TYPE "OutboxEventType" ADD VALUE 'TICKET_COMMENT_ADDED';
ALTER TYPE "OutboxEventType" ADD VALUE 'NOTIFICATION_CREATED';

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "failedAt" TIMESTAMPTZ(3),
ADD COLUMN     "notificationId" UUID,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "ticketId" UUID,
ALTER COLUMN "slaEventId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_id_key" ON "Notification"("organizationId", "id");

-- CreateIndex
CREATE INDEX "OutboxEvent_delivery_pending_idx" ON "OutboxEvent"("type", "processedAt", "failedAt", "nextAttemptAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_notificationId_type_key" ON "OutboxEvent"("notificationId", "type");

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_notificationId_fkey" FOREIGN KEY ("organizationId", "notificationId") REFERENCES "Notification"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Separate rows describe separate delivery purposes; preserve existing SLA sources.
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_delivery_shape" CHECK (
  ("type"::text IN ('SLA_EVENT_SCHEDULED','SLA_EVENT_COMPLETED') AND "slaEventId" IS NOT NULL AND "ticketId" IS NULL AND "notificationId" IS NULL AND "payload" IS NULL)
  OR ("type"::text IN ('TICKET_CREATED','TICKET_UPDATED','TICKET_ASSIGNED','TICKET_STATUS_CHANGED','TICKET_COMMENT_ADDED') AND "slaEventId" IS NULL AND "ticketId" IS NOT NULL AND "notificationId" IS NULL AND "payload" IS NOT NULL AND jsonb_typeof("payload")='object')
  OR ("type"::text='NOTIFICATION_CREATED' AND "slaEventId" IS NULL AND "ticketId" IS NULL AND "notificationId" IS NOT NULL AND "payload" IS NULL)
);
