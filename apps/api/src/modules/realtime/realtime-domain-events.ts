import { isUUID } from 'class-validator';
import {
  TicketStatus,
  TicketPriority,
  CommentVisibility,
  type OutboxEvent,
  type Notification,
} from '../../generated/prisma/client';
export interface EventBase {
  schemaVersion: 1;
  eventId: string;
  organizationId: string;
  occurredAt: string;
}
export interface TicketEventBase extends EventBase {
  ticketId: string;
  ticketNumber: number;
  version: number;
}
export interface DomainPayloads {
  'ticket:created': TicketEventBase & {
    status: TicketStatus;
    priority: TicketPriority;
  };
  'ticket:updated': TicketEventBase;
  'ticket:assigned': TicketEventBase & {
    assignedMemberId: string | null;
    assignedTeamId: string | null;
    previousMemberId: string | null;
    previousTeamId: string | null;
  };
  'ticket:status-changed': TicketEventBase & {
    fromStatus: TicketStatus;
    toStatus: TicketStatus;
    actorMemberId: string;
  };
  'ticket:comment-added': TicketEventBase & {
    commentId: string;
    visibility: CommentVisibility;
    authorMemberId: string;
  };
  'notification:new': EventBase & {
    notificationId: string;
    type: Notification['type'];
    title: string;
    message: string;
    createdAt: string;
  };
}
export const DOMAIN_EVENTS = {
  CREATED: 'ticket:created',
  UPDATED: 'ticket:updated',
  ASSIGNED: 'ticket:assigned',
  STATUS: 'ticket:status-changed',
  COMMENT: 'ticket:comment-added',
  NOTIFICATION: 'notification:new',
} as const;
export type DomainEmission = {
  [K in keyof DomainPayloads]: { name: K; payload: DomainPayloads[K] };
}[keyof DomainPayloads];
export class InvalidRealtimeEvent extends Error {}
function invalid(): never {
  throw new InvalidRealtimeEvent('Invalid realtime source record');
}
function uuid(value: unknown): string {
  return typeof value === 'string' && isUUID(value) ? value : invalid();
}
function nullableId(value: unknown): string | null {
  return value === null ? null : uuid(value);
}
function integer(value: unknown, min: number): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min
    ? value
    : invalid();
}
function enumeration<T extends string>(
  value: unknown,
  choices: readonly T[],
): T {
  return typeof value === 'string' && choices.includes(value as T)
    ? (value as T)
    : invalid();
}
export function mapDomainEvent(
  row: OutboxEvent,
  notification?: Notification,
): DomainEmission {
  const base: EventBase = {
    schemaVersion: 1,
    eventId: row.id,
    organizationId: row.organizationId,
    occurredAt: row.createdAt.toISOString(),
  };
  if (row.type === 'NOTIFICATION_CREATED') {
    if (
      !notification ||
      notification.id !== row.notificationId ||
      notification.organizationId !== row.organizationId
    )
      return invalid();
    return {
      name: DOMAIN_EVENTS.NOTIFICATION,
      payload: {
        ...base,
        notificationId: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt.toISOString(),
        occurredAt: notification.createdAt.toISOString(),
      },
    };
  }
  const p = row.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return invalid();
  const occurredAt =
    typeof p.occurredAt === 'string' &&
    Number.isFinite(Date.parse(p.occurredAt)) &&
    new Date(p.occurredAt).toISOString() === p.occurredAt
      ? p.occurredAt
      : invalid();
  const common: TicketEventBase = {
    ...base,
    ticketId: uuid(row.ticketId),
    ticketNumber: integer(p.ticketNumber, 1),
    version: integer(p.version, 0),
    occurredAt,
  };
  const allowed = ['ticketNumber', 'version', 'occurredAt'];
  let event: DomainEmission;
  switch (row.type) {
    case 'TICKET_CREATED':
      allowed.push('status', 'priority');
      event = {
        name: DOMAIN_EVENTS.CREATED,
        payload: {
          ...common,
          status: enumeration(p.status, Object.values(TicketStatus)),
          priority: enumeration(p.priority, Object.values(TicketPriority)),
        },
      };
      break;
    case 'TICKET_UPDATED':
      event = { name: DOMAIN_EVENTS.UPDATED, payload: common };
      break;
    case 'TICKET_ASSIGNED':
      allowed.push(
        'assignedMemberId',
        'assignedTeamId',
        'previousMemberId',
        'previousTeamId',
      );
      event = {
        name: DOMAIN_EVENTS.ASSIGNED,
        payload: {
          ...common,
          assignedMemberId: nullableId(p.assignedMemberId),
          assignedTeamId: nullableId(p.assignedTeamId),
          previousMemberId: nullableId(p.previousMemberId),
          previousTeamId: nullableId(p.previousTeamId),
        },
      };
      break;
    case 'TICKET_STATUS_CHANGED':
      allowed.push('fromStatus', 'toStatus', 'actorMemberId');
      event = {
        name: DOMAIN_EVENTS.STATUS,
        payload: {
          ...common,
          fromStatus: enumeration(p.fromStatus, Object.values(TicketStatus)),
          toStatus: enumeration(p.toStatus, Object.values(TicketStatus)),
          actorMemberId: uuid(p.actorMemberId),
        },
      };
      break;
    case 'TICKET_COMMENT_ADDED':
      allowed.push('commentId', 'visibility', 'authorMemberId');
      event = {
        name: DOMAIN_EVENTS.COMMENT,
        payload: {
          ...common,
          commentId: uuid(p.commentId),
          visibility: enumeration(
            p.visibility,
            Object.values(CommentVisibility),
          ),
          authorMemberId: uuid(p.authorMemberId),
        },
      };
      break;
    default:
      return invalid();
  }
  if (
    Object.keys(p).length !== allowed.length ||
    Object.keys(p).some((key) => !allowed.includes(key))
  )
    return invalid();
  return event;
}
