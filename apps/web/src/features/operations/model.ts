export const STATUSES = [
  'OPEN',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Member = { membershipId: string; name: string };
export type Team = { id: string; name: string };
export type Sla = {
  id: string;
  type: string;
  dueAt: string;
  completedAt: string | null;
  breachedAt: string | null;
};
export type Ticket = {
  id: string;
  reference: string;
  ticketNumber: number;
  version: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  source: string;
  customer: { id: string; name: string };
  assignedTeam: Team | null;
  assignedMember: Member | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: Sla[];
  comments: {
    id: string;
    body: string;
    visibility: string;
    author: Member | null;
    createdAt: string;
  }[];
  statusHistory: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    changedBy: Member | null;
    reason: string | null;
    createdAt: string;
  }[];
  assignmentHistory: {
    id: string;
    assignedMember: Member | null;
    assignedTeam: Team | null;
    assignedBy: Member | null;
    createdAt: string;
  }[];
  historyHasMore: Record<string, boolean>;
};
export type Page<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
export type Summary = {
  open: number;
  urgent: number;
  atRisk: number;
  breached: number;
  unassigned: number;
  activeWork: number;
  asOf: string;
};
export const words = (value: string) =>
  value.toLowerCase().replaceAll('_', ' ');
export const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function slaState(sla: Sla, status: string, now = Date.now()) {
  if (sla.breachedAt) return { label: 'Breached', tone: 'danger' };
  if (sla.completedAt) return { label: 'Completed', tone: 'healthy' };
  if (status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
  const minutes = Math.ceil((Date.parse(sla.dueAt) - now) / 60000);
  if (minutes <= 0) return { label: 'Breached', tone: 'danger' };
  if (minutes <= 30) return { label: `At risk · ${minutes}m`, tone: 'warning' };
  return {
    label:
      minutes < 120
        ? `Due in ${minutes}m`
        : `Due in ${Math.ceil(minutes / 60)}h`,
    tone: 'signal',
  };
}
export function commands(status: string, role: string) {
  if (role === 'VIEWER') return [];
  const manager = ['OWNER', 'ADMIN', 'MANAGER'].includes(role);
  const rules: Record<string, string[]> = {
    OPEN: manager ? ['triage', 'cancel'] : [],
    TRIAGED: manager ? ['assign', 'cancel'] : [],
    ASSIGNED: manager ? ['start', 'assign', 'cancel'] : ['start'],
    IN_PROGRESS: ['wait-for-customer', 'resolve'],
    WAITING_CUSTOMER: ['resume'],
    RESOLVED: manager ? ['close'] : [],
  };
  return rules[status] ?? [];
}
export function timeline(ticket: Ticket) {
  return [
    ...ticket.statusHistory.map((row) => ({
      id: `status:${row.id}`,
      at: row.createdAt,
      kind: 'status',
      title: `${row.changedBy?.name ?? 'Former member'} · ${words(row.toStatus)}`,
      body: row.reason,
    })),
    ...ticket.assignmentHistory.map((row) => ({
      id: `assignment:${row.id}`,
      at: row.createdAt,
      kind: 'assignment',
      title: `${row.assignedBy?.name ?? 'Former member'} assigned ${[row.assignedTeam?.name, row.assignedMember?.name].filter(Boolean).join(' / ')}`,
      body: null,
    })),
    ...ticket.comments.map((row) => ({
      id: `comment:${row.id}`,
      at: row.createdAt,
      kind: row.visibility,
      title: `${row.author?.name ?? 'Former member'} · ${words(row.visibility)} comment`,
      body: row.body,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export function ticketQuery(filters: Record<string, string>, page: number) {
  const query = new URLSearchParams({
    page: String(page),
    limit: '20',
    sort: 'updatedAt:desc',
  });
  for (const [key, value] of Object.entries(filters))
    if (value.trim()) query.set(key, value.trim());
  return `/tickets?${query}`;
}
