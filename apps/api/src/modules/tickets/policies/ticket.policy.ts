import type {
  Prisma,
  TicketStatus,
  OrganizationRole,
} from '../../../generated/prisma/client';
import type { TenantContext } from '../../auth/types/request-context';
import {
  MANAGERS,
  OPERATORS,
} from '../../../common/domain-transaction.service';
export const transitions = {
  triage: {
    from: 'OPEN',
    to: 'TRIAGED',
    roles: MANAGERS,
    audit: 'TICKET_TRIAGED',
  },
  start: {
    from: 'ASSIGNED',
    to: 'IN_PROGRESS',
    roles: OPERATORS,
    audit: 'TICKET_STARTED',
  },
  'wait-for-customer': {
    from: 'IN_PROGRESS',
    to: 'WAITING_CUSTOMER',
    roles: OPERATORS,
    audit: 'TICKET_WAITING_CUSTOMER',
  },
  resume: {
    from: 'WAITING_CUSTOMER',
    to: 'IN_PROGRESS',
    roles: OPERATORS,
    audit: 'TICKET_RESUMED',
  },
  resolve: {
    from: 'IN_PROGRESS',
    to: 'RESOLVED',
    roles: OPERATORS,
    audit: 'TICKET_RESOLVED',
  },
  close: {
    from: 'RESOLVED',
    to: 'CLOSED',
    roles: MANAGERS,
    audit: 'TICKET_CLOSED',
  },
} as const satisfies Record<
  string,
  {
    from: TicketStatus;
    to: TicketStatus;
    roles: OrganizationRole[];
    audit: string;
  }
>;
export type Transition = keyof typeof transitions;
export function accessibleTickets(
  context: TenantContext,
): Prisma.TicketWhereInput {
  return {
    organizationId: context.organizationId,
    ...(context.role === 'AGENT'
      ? {
          OR: [
            { assignedMemberId: context.membershipId },
            {
              assignedTeam: {
                members: {
                  some: {
                    organizationId: context.organizationId,
                    memberId: context.membershipId,
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}
