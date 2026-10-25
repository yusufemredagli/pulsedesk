ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_nonnegative_version" CHECK ("version" >= 0);

CREATE TABLE "OrganizationTicketCounter" (
  "organizationId" UUID NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OrganizationTicketCounter_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "OrganizationTicketCounter_nonnegative_number" CHECK ("lastNumber" >= 0),
  CONSTRAINT "OrganizationTicketCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Bootstrap counters from all existing organizations without changing existing ticket numbers.
INSERT INTO "OrganizationTicketCounter" ("organizationId", "lastNumber")
SELECT organization."id", COALESCE(MAX(ticket."ticketNumber"), 0)
FROM "Organization" organization
LEFT JOIN "Ticket" ticket ON ticket."organizationId" = organization."id"
GROUP BY organization."id";
