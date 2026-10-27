import { createHash } from 'node:crypto';
import type {
  OrganizationRole,
  TicketPriority,
  TicketSource,
} from '../generated/prisma/client';
// LOCAL DEVELOPMENT / DEMO ONLY. Never use these accounts or this password in production.
export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO_SLUG = 'pulsedesk-demo';
export function demoId(key: string): string {
  const namespace = Buffer.from('d3f48b1c25384caa88063b413d4b2eed', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(key)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const DEMO_ORGANIZATION_ID = demoId('organization');
export const DEMO_USERS = [
  { role: 'OWNER', email: 'owner@pulsedesk.local', name: 'Yusuf Owner' },
  { role: 'MANAGER', email: 'manager@pulsedesk.local', name: 'Merve Manager' },
  { role: 'AGENT', email: 'agent@pulsedesk.local', name: 'Ahmet Agent' },
  { role: 'VIEWER', email: 'viewer@pulsedesk.local', name: 'Selin Viewer' },
] as const satisfies ReadonlyArray<{
  role: OrganizationRole;
  email: string;
  name: string;
}>;
export const DEMO_TEAMS = ['Customer Support', 'Technical Support'] as const;
export const DEMO_CUSTOMERS = [
  {
    name: 'Acme Teknoloji',
    email: 'destek@acmeteknoloji.test',
    phone: '+90 312 555 10 01',
  },
  {
    name: 'Nova Lojistik',
    email: 'operasyon@novalojistik.test',
    phone: '+90 312 555 10 02',
  },
  {
    name: 'Atlas Yazılım',
    email: 'destek@atlasyazilim.test',
    phone: '+90 312 555 10 03',
  },
] as const;
export const DEMO_POLICIES = [
  { priority: 'URGENT', firstResponseMinutes: 15, resolutionMinutes: 120 },
  { priority: 'HIGH', firstResponseMinutes: 30, resolutionMinutes: 240 },
  { priority: 'MEDIUM', firstResponseMinutes: 60, resolutionMinutes: 480 },
  { priority: 'LOW', firstResponseMinutes: 120, resolutionMinutes: 1440 },
] as const satisfies ReadonlyArray<{
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}>;
export const DEMO_TICKETS = [
  {
    subject: 'Yönetici paneline giriş yapılamıyor',
    customer: 0,
    priority: 'URGENT',
    source: 'WEB',
    ageMinutes: 2,
    steps: [],
  },
  {
    subject: 'Fatura toplamı hatalı görünüyor',
    customer: 1,
    priority: 'HIGH',
    source: 'EMAIL',
    ageMinutes: 8,
    steps: ['triage'],
  },
  {
    subject: 'Yeni kullanıcı hesabına erişilemiyor',
    customer: 2,
    priority: 'MEDIUM',
    source: 'PHONE',
    ageMinutes: 40,
    steps: ['triage', 'assign'],
    team: 0,
    member: 'AGENT',
  },
  {
    subject: 'API bağlantısı zaman zaman kopuyor',
    customer: 0,
    priority: 'HIGH',
    source: 'CHAT',
    ageMinutes: 250,
    steps: ['triage', 'assign', 'start'],
    team: 1,
    member: 'MANAGER',
  },
  {
    subject: 'Rapor çıktısı için ek bilgi bekleniyor',
    customer: 1,
    priority: 'LOW',
    source: 'WEB',
    ageMinutes: 10,
    steps: ['triage', 'assign', 'start', 'wait-for-customer'],
    team: 0,
    member: 'AGENT',
  },
  {
    subject: 'Bildirim problemi çözüldü',
    customer: 2,
    priority: 'MEDIUM',
    source: 'INTERNAL',
    ageMinutes: 90,
    steps: ['triage', 'assign', 'start', 'resolve'],
    team: 0,
    member: 'AGENT',
  },
] as const satisfies ReadonlyArray<{
  subject: string;
  customer: number;
  priority: TicketPriority;
  source: TicketSource;
  ageMinutes: number;
  steps: readonly string[];
  team?: number;
  member?: 'AGENT' | 'MANAGER';
}>;
