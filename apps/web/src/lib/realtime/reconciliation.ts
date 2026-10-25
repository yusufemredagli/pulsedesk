import { isObject, isUuid } from '../api/contracts';
export const DOMAIN_EVENTS = [
  'ticket:created',
  'ticket:assigned',
  'ticket:status-changed',
  'ticket:comment-added',
  'notification:new',
] as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];
export interface EventMetadata {
  eventId: string;
  name: DomainEvent;
  occurredAt: string;
  ticketId?: string;
  ticketNumber?: number;
  version?: number;
  notificationId?: string;
  toStatus?: string;
  priority?: string;
}
export class Reconciliation {
  private seen = new Map<string, true>();
  private versions = new Map<string, number>();
  constructor(private readonly bound = 256) {}
  observe(ticketId: string, version: number): void {
    if (version < (this.versions.get(ticketId) ?? -1)) return;
    this.versions.delete(ticketId);
    this.versions.set(ticketId, version);
    this.trim(this.versions);
  }
  reset(): void {
    this.seen.clear();
    this.versions.clear();
  }
  private trim<T>(map: Map<string, T>): void {
    while (map.size > this.bound) map.delete(map.keys().next().value!);
  }
  accept(
    name: DomainEvent,
    value: unknown,
    organizationId: string,
  ): EventMetadata | null {
    if (
      !isObject(value) ||
      value.schemaVersion !== 1 ||
      !isUuid(value.eventId) ||
      value.organizationId !== organizationId ||
      typeof value.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(value.occurredAt)) ||
      this.seen.has(value.eventId)
    )
      return null;
    const base: EventMetadata = {
      eventId: value.eventId,
      name,
      occurredAt: value.occurredAt,
    };
    if (name === 'notification:new') {
      if (!isUuid(value.notificationId)) return null;
      base.notificationId = value.notificationId;
    } else {
      if (
        !isUuid(value.ticketId) ||
        typeof value.version !== 'number' ||
        !Number.isSafeInteger(value.version) ||
        value.version < 0 ||
        typeof value.ticketNumber !== 'number' ||
        !Number.isSafeInteger(value.ticketNumber) ||
        value.ticketNumber < 1
      )
        return null;
      if ((this.versions.get(value.ticketId) ?? -1) > value.version)
        return null;
      this.versions.delete(value.ticketId);
      this.versions.set(value.ticketId, value.version);
      this.trim(this.versions);
      if (
        typeof value.toStatus === 'string' &&
        [
          'OPEN',
          'TRIAGED',
          'ASSIGNED',
          'IN_PROGRESS',
          'WAITING_CUSTOMER',
          'RESOLVED',
          'CLOSED',
          'CANCELLED',
        ].includes(value.toStatus)
      )
        base.toStatus = value.toStatus;
      if (
        typeof value.priority === 'string' &&
        ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(value.priority)
      )
        base.priority = value.priority;
      Object.assign(base, {
        ticketId: value.ticketId,
        ticketNumber: value.ticketNumber,
        version: value.version,
      });
    }
    this.seen.set(value.eventId, true);
    this.trim(this.seen);
    return base;
  }
}
