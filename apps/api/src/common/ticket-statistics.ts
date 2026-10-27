import { Prisma } from '../generated/prisma/client';
import type { TenantContext } from '../modules/auth/types/request-context';
import { accessibleTickets } from '../modules/tickets/policies/ticket.policy';
export type TicketStatistics = {
  totalTickets: number;
  openTickets: number;
  activeTickets: number;
  lastActivityAt: Date | null;
};
export const emptyStatistics = (): TicketStatistics => ({
  totalTickets: 0,
  openTickets: 0,
  activeTickets: 0,
  lastActivityAt: null,
});
/** Bounded parent IDs, bulk aggregates, and the same live agent visibility boundary as tickets. */
export async function ticketStatistics(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  field: 'customerId' | 'assignedTeamId',
  ids: string[],
) {
  const result = new Map(ids.map((id) => [id, emptyStatistics()]));
  if (!ids.length) return result;
  const groups = await tx.ticket.groupBy({
    by: [field, 'status'],
    where: { AND: [accessibleTickets(context), { [field]: { in: ids } }] },
    _count: { id: true },
    _max: { updatedAt: true },
  });
  for (const row of groups) {
    const id = row[field];
    if (!id) continue;
    const stats = result.get(id)!;
    stats.totalTickets += row._count.id;
    if (!['RESOLVED', 'CLOSED', 'CANCELLED'].includes(row.status))
      stats.openTickets += row._count.id;
    if (row.status === 'IN_PROGRESS') stats.activeTickets += row._count.id;
    const at = row._max.updatedAt;
    if (at && (!stats.lastActivityAt || at > stats.lastActivityAt))
      stats.lastActivityAt = at;
  }
  // Comments intentionally do not change Ticket.updatedAt. Include them in latest activity without fetching ticket histories.
  const column =
    field === 'customerId'
      ? Prisma.sql`t."customerId"`
      : Prisma.sql`t."assignedTeamId"`;
  const agent =
    context.role === 'AGENT'
      ? Prisma.sql`AND (t."assignedMemberId"=${context.membershipId}::uuid OR EXISTS (SELECT 1 FROM "TeamMember" m WHERE m."organizationId"=t."organizationId" AND m."teamId"=t."assignedTeamId" AND m."memberId"=${context.membershipId}::uuid))`
      : Prisma.empty;
  const comments = await tx.$queryRaw<Array<{ id: string; at: Date }>>(
    Prisma.sql`SELECT ${column} AS id, MAX(c."createdAt") AS at FROM "TicketComment" c JOIN "Ticket" t ON t."organizationId"=c."organizationId" AND t."id"=c."ticketId" WHERE t."organizationId"=${context.organizationId}::uuid AND ${column} IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ${agent} GROUP BY ${column}`,
  );
  for (const row of comments) {
    const stats = result.get(row.id)!;
    if (!stats.lastActivityAt || row.at > stats.lastActivityAt)
      stats.lastActivityAt = row.at;
  }
  return result;
}
