import type { Prisma, Customer, Team } from '../generated/prisma/client';
export const memberSelect = {
  id: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.OrganizationMemberSelect;
export type MemberView = Prisma.OrganizationMemberGetPayload<{
  select: typeof memberSelect;
}>;
export function mapMember(member: MemberView | null) {
  return member
    ? {
        membershipId: member.id,
        userId: member.user.id,
        name: member.user.name,
        avatarUrl: member.user.avatarUrl,
      }
    : null;
}
export function mapTeam(team: Team) {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}
export function mapCustomer(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    companyName: customer.companyName,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
