/** Display-only Turkish labels. Wire values and persisted data stay unchanged. */
export const DISPLAY_LABELS: Readonly<Record<string, string>> = {
  OPEN: 'Açık',
  TRIAGED: 'İncelendi',
  ASSIGNED: 'Atandı',
  IN_PROGRESS: 'İşlemde',
  WAITING_CUSTOMER: 'Müşteri Bekleniyor',
  RESOLVED: 'Çözüldü',
  CLOSED: 'Kapatıldı',
  CANCELLED: 'İptal Edildi',
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
  PUBLIC: 'Müşteriye Açık',
  INTERNAL: 'Dahili',
  FIRST_RESPONSE: 'İlk Yanıt',
  RESOLUTION: 'Çözüm',
  WEB: 'Web',
  EMAIL: 'E-posta',
  PHONE: 'Telefon',
  CHAT: 'Sohbet',
  OWNER: 'Çalışma Alanı Sahibi',
  ADMIN: 'Yönetici',
  MANAGER: 'Operasyon Yöneticisi',
  AGENT: 'Destek Uzmanı',
  VIEWER: 'Görüntüleyici',
};
export const displayLabel = (value: string | undefined) =>
  value && Object.hasOwn(DISPLAY_LABELS, value)
    ? DISPLAY_LABELS[value]!
    : 'Bilinmiyor';

/** Translate only known system-generated SLA copy; preserve user-authored content. */
export function notificationCopy(note: {
  type: string;
  title: string;
  message: string;
}) {
  if (
    !['SLA_FIRST_RESPONSE_BREACHED', 'SLA_RESOLUTION_BREACHED'].includes(
      note.type,
    )
  )
    return { title: note.title, message: note.message };
  const titles: Record<string, string> = {
    'First response SLA breached': 'İlk Yanıt SLA Süresi Aşıldı',
    'Resolution SLA breached': 'Çözüm SLA Süresi Aşıldı',
  };
  const match =
    /^Ticket (PD-\d+) exceeded its (first response|resolution) deadline\.$/.exec(
      note.message,
    );
  return {
    title: titles[note.title] ?? note.title,
    message: match
      ? `${match[1]} numaralı talebin ${match[2] === 'first response' ? 'ilk yanıt' : 'çözüm'} süresi aşıldı.`
      : note.message,
  };
}
