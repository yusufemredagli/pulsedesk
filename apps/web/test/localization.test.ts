import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { displayLabel, notificationCopy } from '../src/lib/presentation';
import {
  date,
  slaState,
  STATUSES,
  PRIORITIES,
  ticketQuery,
} from '../src/features/operations/model';
import { ApiError } from '../src/lib/api/client';
import { validateAuth } from '../src/features/auth/validation';
test('Turkish status and priority displays preserve every wire value', () => {
  assert.deepEqual(STATUSES.map(displayLabel), [
    'Açık',
    'İncelendi',
    'Atandı',
    'İşlemde',
    'Müşteri Bekleniyor',
    'Çözüldü',
    'Kapatıldı',
    'İptal Edildi',
  ]);
  assert.deepEqual(PRIORITIES.map(displayLabel), [
    'Düşük',
    'Orta',
    'Yüksek',
    'Acil',
  ]);
  const query = new URL(
    ticketQuery({ status: 'WAITING_CUSTOMER', priority: 'URGENT' }, 1),
    'http://local',
  );
  assert.equal(query.searchParams.get('status'), 'WAITING_CUSTOMER');
  assert.equal(query.searchParams.get('priority'), 'URGENT');
  assert.equal(displayLabel('PUBLIC'), 'Müşteriye Açık');
  assert.equal(displayLabel('INTERNAL'), 'Dahili');
  assert.equal(displayLabel('FIRST_RESPONSE'), 'İlk Yanıt');
  assert.equal(displayLabel('RESOLUTION'), 'Çözüm');
  assert.equal(displayLabel('UNKNOWN'), 'Bilinmiyor');
  assert.equal(displayLabel('toString'), 'Bilinmiyor');
});
test('dates and SLA durations use Turkish display without changing deadlines', () => {
  assert.match(date('2026-10-25T12:00:00Z'), /Eki/);
  assert.match(date('2026-10-25T12:00:00Z'), /\d{2}:\d{2}/);
  const now = Date.parse('2026-10-25T12:00:00Z');
  const sla = {
    id: 'sla',
    type: 'RESOLUTION',
    dueAt: new Date(now + 42 * 60000).toISOString(),
    completedAt: null,
    breachedAt: null,
  };
  assert.equal(slaState(sla, 'OPEN', now).label, 'Kalan Süre: 42 dk');
  assert.equal(slaState(sla, 'OPEN', now + 20 * 60000).label, 'Riskte · 22 dk');
  assert.equal(sla.dueAt, '2026-10-25T12:42:00.000Z');
});
test('known SLA notifications are localized only for display and custom content is retained', () => {
  const note = {
    type: 'SLA_FIRST_RESPONSE_BREACHED',
    title: 'First response SLA breached',
    message: 'Ticket PD-000142 exceeded its first response deadline.',
  };
  assert.deepEqual(notificationCopy(note), {
    title: 'İlk Yanıt SLA Süresi Aşıldı',
    message: 'PD-000142 numaralı talebin ilk yanıt süresi aşıldı.',
  });
  assert.equal(note.title, 'First response SLA breached');
  assert.deepEqual(
    notificationCopy({
      ...note,
      type: 'SLA_RESOLUTION_BREACHED',
      title: 'Resolution SLA breached',
      message: 'Ticket PD-000142 exceeded its resolution deadline.',
    }),
    {
      title: 'Çözüm SLA Süresi Aşıldı',
      message: 'PD-000142 numaralı talebin çözüm süresi aşıldı.',
    },
  );
  const custom = {
    type: 'SYSTEM',
    title: 'Customer supplied title',
    message: 'Do not rewrite user content.',
  };
  assert.deepEqual(notificationCopy(custom), {
    title: custom.title,
    message: custom.message,
  });
});
test('safe errors, auth validation, page language and priority form values are Turkish without enum submission changes', () => {
  assert.match(new ApiError(403).message, /yetkiniz yok/);
  assert.match(new ApiError(0).message, /Bağlantınızı/);
  assert.deepEqual(
    validateAuth({ email: 'invalid', password: 'short' }, false),
    {
      email: 'Geçerli bir iş e-postası adresi girin.',
      password: '10–128 karakter kullanın.',
    },
  );
  assert.match(
    readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8'),
    /lang="tr"/,
  );
  assert.match(
    readFileSync(
      new URL('../src/features/operations/create.tsx', import.meta.url),
      'utf8',
    ),
    /value=\{value\}/,
  );
});
