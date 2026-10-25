export const SLA_OUTBOX_TYPES = [
  'SLA_EVENT_SCHEDULED',
  'SLA_EVENT_COMPLETED',
] as const;
export type SlaOutboxType = (typeof SLA_OUTBOX_TYPES)[number];
export const REALTIME_OUTBOX_TYPES = [
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_ASSIGNED',
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENT_ADDED',
  'NOTIFICATION_CREATED',
] as const;
export type RealtimeOutboxType = (typeof REALTIME_OUTBOX_TYPES)[number];
