import type {
  Prisma,
  Ticket,
  TicketStatus,
  CommentVisibility,
} from '../../generated/prisma/client';
export type TicketChange =
  | {
      type: 'TICKET_CREATED';
      status: TicketStatus;
      priority: Ticket['priority'];
    }
  | {
      type: 'TICKET_ASSIGNED';
      assignedMemberId: string | null;
      assignedTeamId: string | null;
      previousMemberId: string | null;
      previousTeamId: string | null;
    }
  | {
      type: 'TICKET_STATUS_CHANGED';
      fromStatus: TicketStatus;
      toStatus: TicketStatus;
      actorMemberId: string;
    }
  | {
      type: 'TICKET_COMMENT_ADDED';
      commentId: string;
      visibility: CommentVisibility;
      authorMemberId: string;
    };
// Application-side persistence abstraction. It has no Socket.IO dependency.
export async function recordTicketChange(
  tx: Prisma.TransactionClient,
  ticket: Pick<Ticket, 'id' | 'organizationId' | 'ticketNumber' | 'version'>,
  change: TicketChange,
  at: Date,
): Promise<void> {
  const { type, ...details } = change;
  await tx.outboxEvent.create({
    data: {
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      type,
      payload: {
        ticketNumber: ticket.ticketNumber,
        version: ticket.version,
        occurredAt: at.toISOString(),
        ...details,
      },
    },
  });
}
export async function createNotifications(
  tx: Prisma.TransactionClient,
  data: Prisma.NotificationCreateManyInput[],
): Promise<void> {
  if (!data.length) return;
  const rows = await tx.notification.createManyAndReturn({
    data,
    select: { id: true, organizationId: true },
  });
  await tx.outboxEvent.createMany({
    data: rows.map((row) => ({
      organizationId: row.organizationId,
      notificationId: row.id,
      type: 'NOTIFICATION_CREATED' as const,
    })),
  });
}
