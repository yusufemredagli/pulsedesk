import type { Prisma } from '../../../generated/prisma/client';
import { memberSelect, mapMember } from '../../../common/public-mappers';
export const ticketInclude = {
  customer: {
    select: { id: true, name: true, email: true, companyName: true },
  },
  assignedTeam: { select: { id: true, name: true } },
  assignedMember: { select: memberSelect },
} satisfies Prisma.TicketInclude;
export type TicketView = Prisma.TicketGetPayload<{
  include: typeof ticketInclude;
}>;
export function mapTicket(ticket: TicketView) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    reference: `PD-${String(ticket.ticketNumber).padStart(6, '0')}`,
    version: ticket.version,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    customer: {
      id: ticket.customer.id,
      name: ticket.customer.name,
      email: ticket.customer.email,
      companyName: ticket.customer.companyName,
    },
    assignedTeam: ticket.assignedTeam
      ? { id: ticket.assignedTeam.id, name: ticket.assignedTeam.name }
      : null,
    assignedMember: mapMember(ticket.assignedMember),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
  };
}
export function timeline<T>(rows: T[]) {
  return { data: rows.slice(0, 100).reverse(), hasMore: rows.length > 100 };
}
