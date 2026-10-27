export type Statistics = {
  totalTickets: number;
  openTickets: number;
  activeTickets: number;
  lastActivityAt: string | null;
};
export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  statistics: Statistics;
};
export type Team = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  statistics: Statistics;
};
export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};
export type Policy = {
  id: string;
  name: string;
  priority: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
export type Settings = {
  workspace: { id: string; name: string; slug: string; updatedAt: string };
  account: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    updatedAt: string;
  };
  role: string;
};
export const canManageOperations = (role: string | undefined) =>
  !!role && ['OWNER', 'ADMIN', 'MANAGER'].includes(role);
export const canManageWorkspace = (role: string | undefined) =>
  !!role && ['OWNER', 'ADMIN'].includes(role);
export function durationMinutes(value: string, unit: string): number {
  const number = Number(value.replace(',', '.'));
  const minutes = number * (unit === 'hours' ? 60 : 1);
  if (
    !['hours', 'minutes'].includes(unit) ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 525600
  )
    throw new Error(
      'Süre 1–525.600 dakika arasında, tam dakika olarak ifade edilmelidir.',
    );
  return minutes;
}
export const durationLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} saat` : `${minutes} dakika`;
export function listQuery(
  base: string,
  search: string,
  page: number,
  sort?: string,
) {
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (search.trim()) query.set('search', search.trim());
  if (sort) query.set('sort', sort);
  return `${base}?${query}`;
}
