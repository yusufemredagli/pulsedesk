import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(
  new URL('../../../api/package.json', import.meta.url),
);
require('reflect-metadata');
const {
    PrismaService,
  } = require('./dist/infrastructure/database/prisma.service.js'),
  { ConfigService } = require('@nestjs/config');
const {
  DEMO_ORGANIZATION_ID: organizationId,
  DEMO_PASSWORD,
  demoId,
} = require('./dist/demo/manifest.js');
assert.ok(
  process.env.TEST_DATABASE_URL &&
    process.env.TEST_DATABASE_URL === process.env.DATABASE_URL,
  'Use matching DATABASE_URL/TEST_DATABASE_URL for a dedicated migrated and demo-seeded database.',
);
const db = new PrismaService(
  new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL }),
);
await db.onModuleInit();
assert.ok(
  await db.auditLog.findUnique({ where: { id: demoId('manifest:v1') } }),
  'Run pnpm seed explicitly in the isolated test database.',
);
const base = process.env.BROWSER_WEB_URL ?? 'http://localhost:3400',
  api = process.env.BROWSER_API_URL ?? 'http://localhost:4400',
  suffix = randomUUID().slice(0, 8),
  artifacts = mkdtempSync(join(tmpdir(), 'pulsedesk-management-browser-'));
const savedOrg = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
  }),
  savedOwner = await db.user.findUniqueOrThrow({
    where: { id: demoId('user:OWNER') },
  }),
  savedPolicy = await db.slaPolicy.findUniqueOrThrow({
    where: { id: demoId('policy:HIGH') },
  });
const customerIds = Array.from({ length: 21 }, () => randomUUID());
let createdCustomerId, createdTeamId, sandboxId;
await db.customer.createMany({
  data: customerIds.map((id, index) => ({
    id,
    organizationId,
    name: `Phase7 Arama ${suffix} ${String(index).padStart(2, '0')}`,
    email: `phase7-${index}-${suffix}@example.invalid`,
  })),
});
const browser = await chromium.launch({ headless: true });
const pages = {},
  contexts = [],
  errors = [];
async function login(role) {
  const context = await browser.newContext({
    locale: 'tr-TR',
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  pages[role] = page;
  await page.goto(base + '/login');
  await page
    .getByLabel('İş e-postası', { exact: true })
    .fill(`${role}@pulsedesk.local`);
  await page.getByLabel('Şifre', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
  await page.waitForURL(base + '/select-organization');
  await page.getByRole('button', { name: /PulseDesk Demo/ }).click();
  await page.waitForURL(base + '/app/dashboard');
  await page.getByText('Canlı bağlantı etkin', { exact: true }).waitFor();
  return page;
}
async function apiAs(page, path, method = 'GET', body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('pulsedesk.session.v1')),
    );
    const response = await fetch(api + path, {
      method,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'x-organization-id': session.selectedOrganizationId,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && attempt === 0) {
      await page.waitForTimeout(500);
      continue;
    }
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
}
async function navigate(page, path) {
  if (new URL(page.url()).pathname === path) return;
  const parent = path.startsWith('/app/customers/')
    ? '/app/customers'
    : path.startsWith('/app/teams/')
      ? '/app/teams'
      : path;
  let link = page.locator(`.sidebar a[href="${parent}"]`);
  if (!(await link.isVisible())) {
    const menu = page.locator('.mobile-menu details');
    if (!(await menu.evaluate((node) => node.open)))
      await page.getByLabel('Gezinmeyi Aç', { exact: true }).click();
    link = page.locator(`.mobile-menu a[href="${parent}"]`);
  }
  await link.click();
  await page.waitForURL(base + parent);
  if (path !== parent) {
    const rowLink = page.locator(`a[href="${path}"]`).first();
    if (!(await rowLink.isVisible())) {
      const label =
        parent === '/app/customers' ? 'Müşterilerde ara' : 'Ekiplerde ara';
      await page
        .getByLabel(label, { exact: true })
        .fill(
          parent === '/app/customers'
            ? `Yeni Müşteri ${suffix}`
            : `Yeni Ekip ${suffix}`,
        );
    }
    await rowLink.click();
    await page.waitForURL(base + path);
  }
  await page.locator('.ops-heading').waitFor();
}
async function save(page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Kaydet', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
try {
  const manager = await login('manager'),
    agent = await login('agent'),
    viewer = await login('viewer'),
    owner = await login('owner');
  for (const page of Object.values(pages))
    assert.equal(
      await page
        .locator('.sidebar')
        .getByText('Yakında', { exact: true })
        .count(),
      0,
    );
  // Manager: server-side customer search/paging, create/edit and a preselected new ticket.
  await navigate(manager, '/app/customers');
  await manager
    .getByLabel('Müşterilerde ara', { exact: true })
    .fill(`Phase7 Arama ${suffix}`);
  await manager.getByText('21 kayıt · Sayfa 1 / 2', { exact: true }).waitFor();
  await manager
    .locator('.table-pagination')
    .getByRole('button', { name: 'Sonraki', exact: true })
    .click();
  await manager.getByText('21 kayıt · Sayfa 2 / 2', { exact: true }).waitFor();
  await manager
    .getByLabel('Müşterilerde ara', { exact: true })
    .fill('bulunamayan-' + suffix);
  await manager
    .getByRole('heading', { name: 'Müşteri bulunamadı', exact: true })
    .waitFor();
  await manager
    .getByRole('button', { name: 'Müşteri Oluştur', exact: true })
    .click();
  let dialog = manager.getByRole('dialog');
  await dialog
    .getByLabel('Müşteri Adı', { exact: true })
    .fill(`Yeni Müşteri ${suffix}`);
  await dialog
    .getByLabel('E-posta', { exact: true })
    .fill(`customer-${suffix}@example.invalid`);
  await dialog.getByLabel('Telefon', { exact: true }).fill('+90 312 555 10 44');
  await save(manager);
  createdCustomerId = (
    await db.customer.findFirstOrThrow({
      where: { organizationId, email: `customer-${suffix}@example.invalid` },
    })
  ).id;
  customerIds.push(createdCustomerId);
  await manager
    .getByLabel('Müşterilerde ara', { exact: true })
    .fill(`Yeni Müşteri ${suffix}`);
  await manager
    .locator(`a[href="/app/customers/${createdCustomerId}"]`)
    .click();
  await manager.waitForURL(base + `/app/customers/${createdCustomerId}`);
  await manager.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await manager
    .getByRole('dialog')
    .getByLabel('Telefon', { exact: true })
    .fill('+90 312 555 10 45');
  await save(manager);
  await manager.getByText('+90 312 555 10 45', { exact: true }).waitFor();
  await manager
    .getByRole('button', { name: 'Yeni Talep Oluştur', exact: true })
    .click();
  dialog = manager.getByRole('dialog');
  await dialog.getByText(`Yeni Müşteri ${suffix}`, { exact: true }).waitFor();
  await dialog
    .getByLabel('Konu', { exact: true })
    .fill(`Müşteri geçmişi ${suffix}`);
  await dialog
    .getByLabel('Açıklama', { exact: true })
    .fill('Müşteriden açılan gerçek demo talebi.');
  await dialog
    .getByRole('button', { name: 'Yeni Talep Oluştur', exact: true })
    .click();
  await manager.waitForURL(/\/app\/tickets\/[a-f0-9-]+$/);
  await navigate(manager, `/app/customers/${createdCustomerId}`);
  await manager
    .locator('.management-metrics>div')
    .first()
    .locator('strong')
    .filter({ hasText: /^1$/ })
    .waitFor();
  const extra = await apiAs(owner, '/tickets', 'POST', {
    customerId: createdCustomerId,
    subject: `Canlı müşteri hareketi ${suffix}`,
    description:
      'İkinci oturumdan HTTP işlemi; socket yalnızca yeniden okuma ipucu verir.',
    priority: 'HIGH',
    source: 'WEB',
  });
  await manager
    .locator('.management-metrics>div')
    .first()
    .locator('strong')
    .filter({ hasText: /^2$/ })
    .waitFor();
  await manager
    .getByRole('link', { name: new RegExp(`Canlı müşteri hareketi ${suffix}`) })
    .waitFor();
  await manager.screenshot({
    path: join(artifacts, 'customer.png'),
    fullPage: true,
  });
  // Team management, duplicate protection, real DELETE/CORS and live workload.
  await navigate(manager, '/app/teams');
  await manager
    .getByRole('button', { name: 'Ekip Oluştur', exact: true })
    .click();
  await manager
    .getByRole('dialog')
    .getByLabel('Ekip Adı', { exact: true })
    .fill(`Yeni Ekip ${suffix}`);
  await manager
    .getByRole('dialog')
    .getByLabel('Açıklama', { exact: true })
    .fill('Phase 7 operasyon ekibi');
  await save(manager);
  createdTeamId = (
    await db.team.findFirstOrThrow({
      where: { organizationId, name: `Yeni Ekip ${suffix}` },
    })
  ).id;
  await manager
    .locator(`a[href="/app/teams/${createdTeamId}"]`)
    .first()
    .click();
  await manager.waitForURL(base + `/app/teams/${createdTeamId}`);
  await manager.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await manager
    .getByRole('dialog')
    .getByLabel('Açıklama', { exact: true })
    .fill('Güncellenen operasyon ekibi');
  await save(manager);
  await manager
    .getByText('Güncellenen operasyon ekibi', { exact: true })
    .waitFor();
  await manager.getByRole('button', { name: 'Üye Ekle', exact: true }).click();
  await manager
    .getByRole('dialog')
    .getByLabel('Üye seçin', { exact: true })
    .selectOption(demoId('membership:AGENT'));
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Ekle', exact: true })
    .click();
  await manager.getByRole('dialog').waitFor({ state: 'hidden' });
  await manager
    .locator('.team-member-list')
    .getByText('Destek Uzmanı · Etkin hesap', { exact: true })
    .waitFor();
  await manager.getByRole('button', { name: 'Üye Ekle', exact: true }).click();
  await manager
    .getByRole('dialog')
    .getByLabel('Üye seçin', { exact: true })
    .selectOption(demoId('membership:AGENT'));
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Ekle', exact: true })
    .click();
  await manager.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal(
    await db.teamMember.count({
      where: { organizationId, teamId: createdTeamId },
    }),
    1,
  );
  await manager
    .getByRole('dialog')
    .getByLabel('Pencereyi Kapat', { exact: true })
    .click();
  await manager
    .getByLabel('Ahmet Agent kişisini ekipten çıkar', { exact: true })
    .click();
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Ekipten Çıkar', exact: true })
    .click();
  await manager.getByRole('dialog').waitFor({ state: 'hidden' });
  await manager
    .getByRole('heading', { name: 'Bu ekipte henüz üye yok', exact: true })
    .waitFor();
  let work = await apiAs(owner, `/tickets/${extra.id}/triage`, 'POST', {
    expectedVersion: extra.version,
  });
  work = await apiAs(owner, `/tickets/${extra.id}/assign`, 'POST', {
    expectedVersion: work.version,
    assignedTeamId: createdTeamId,
  });
  await apiAs(owner, `/tickets/${extra.id}/start`, 'POST', {
    expectedVersion: work.version,
  });
  await manager
    .locator('.management-metrics>div')
    .nth(2)
    .locator('strong')
    .filter({ hasText: /^1$/ })
    .waitFor();
  await manager
    .getByRole('link', { name: new RegExp(`Canlı müşteri hareketi ${suffix}`) })
    .waitFor();
  await manager.screenshot({
    path: join(artifacts, 'team.png'),
    fullPage: true,
  });
  // Agent/viewer management controls stay absent; their existing directory reads remain available.
  for (const [role, page] of [
    ['agent', agent],
    ['viewer', viewer],
  ]) {
    await navigate(page, '/app/customers');
    await page.locator('.management-table tbody tr').first().waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Müşteri Oluştur', exact: true })
        .count(),
      0,
    );
    await page
      .getByLabel('Müşterilerde ara', { exact: true })
      .fill('Acme Teknoloji');
    await page
      .locator(
        `a[href="/app/customers/${demoId('customer:destek@acmeteknoloji.test')}"]`,
      )
      .click();
    await page
      .locator('.management-metrics>div')
      .first()
      .locator('strong')
      .filter({ hasText: new RegExp(`^${role === 'agent' ? 0 : 2}$`) })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Düzenle', exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Yeni Talep Oluştur', exact: true })
        .count(),
      role === 'agent' ? 1 : 0,
    );
    await navigate(page, '/app/teams');
    await page.locator('.team-card').first().waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Ekip Oluştur', exact: true })
        .count(),
      0,
    );
    await page
      .locator(`a[href="/app/teams/${demoId('team:Customer Support')}"]`)
      .first()
      .click();
    await page.locator('.team-member-list').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Üye Ekle', exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Düzenle', exact: true }).count(),
      0,
    );
    await navigate(page, '/app/sla-policies');
    await page.locator('.policy-record').first().waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Düzenle', exact: true }).count(),
      0,
    );
    await navigate(page, '/app/settings');
    await page.getByRole('heading', { name: 'Hesabım', exact: true }).waitFor();
    assert.equal(
      await page
        .getByLabel('Çalışma alanı adını düzenle', { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByLabel('Görünen adını düzenle', { exact: true }).count(),
      1,
    );
  }
  await navigate(manager, '/app/sla-policies');
  await manager.locator('.policy-record').first().waitFor();
  assert.equal(
    await manager.getByRole('button', { name: 'Düzenle', exact: true }).count(),
    0,
  );
  // Owner: SLA units, activation, validation, historical deadline preservation.
  const oldEvents = await db.slaEvent.findMany({
    where: {
      organizationId,
      ticketId: { in: [1, 2, 3, 4, 5, 6].map((n) => demoId(`ticket:${n}`)) },
    },
    orderBy: { id: 'asc' },
  });
  await navigate(owner, '/app/sla-policies');
  const high = owner.locator('.policy-group').filter({
    has: owner.getByRole('heading', { name: 'Yüksek Öncelik', exact: true }),
  });
  await high.getByRole('button', { name: 'Düzenle', exact: true }).click();
  dialog = owner.getByRole('dialog');
  await dialog
    .getByLabel('İlk Yanıt Hedefi birimi', { exact: true })
    .selectOption('hours');
  await dialog.getByLabel('İlk Yanıt Hedefi', { exact: true }).fill('1');
  await dialog.getByLabel('Çözüm Hedefi', { exact: true }).fill('6');
  await save(owner);
  await high.getByText('1 saat', { exact: true }).waitFor();
  assert.deepEqual(
    (
      await db.slaEvent.findMany({
        where: { id: { in: oldEvents.map((row) => row.id) } },
        orderBy: { id: 'asc' },
      })
    ).map((row) => row.dueAt.toISOString()),
    oldEvents.map((row) => row.dueAt.toISOString()),
  );
  await high.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await owner
    .getByRole('dialog')
    .getByRole('checkbox', { name: 'Etkin', exact: true })
    .uncheck();
  await save(owner);
  await high.getByText('Etkin Değil', { exact: true }).waitFor();
  const noPolicy = await apiAs(owner, '/tickets', 'POST', {
    customerId: createdCustomerId,
    subject: `Politikasız talep ${suffix}`,
    description: 'Etkin olmayan politika testi',
    priority: 'HIGH',
    source: 'WEB',
  });
  assert.equal(
    await db.slaEvent.count({ where: { ticketId: noPolicy.id } }),
    0,
  );
  await high.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await owner
    .getByRole('dialog')
    .getByRole('checkbox', { name: 'Etkin', exact: true })
    .check();
  await save(owner);
  await high.getByText('Etkin', { exact: true }).waitFor();
  await high.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await owner
    .getByRole('dialog')
    .getByLabel('İlk Yanıt Hedefi birimi', { exact: true })
    .selectOption('minutes');
  await owner
    .getByRole('dialog')
    .getByLabel('İlk Yanıt Hedefi', { exact: true })
    .fill('1.5');
  await owner
    .getByRole('dialog')
    .getByRole('button', { name: 'Kaydet', exact: true })
    .click();
  await owner.getByRole('dialog').getByRole('alert').waitFor();
  await owner
    .getByRole('dialog')
    .getByLabel('Pencereyi Kapat', { exact: true })
    .click();
  await owner.screenshot({ path: join(artifacts, 'sla.png'), fullPage: true });
  // Owner: workspace conflict recovery and safe profile editing.
  await navigate(owner, '/app/settings');
  await owner
    .getByLabel('Çalışma alanı adını düzenle', { exact: true })
    .click();
  const oldSettings = await apiAs(owner, '/settings');
  await apiAs(owner, '/settings/workspace', 'PATCH', {
    name: `Eşzamanlı Demo ${suffix}`,
    expectedUpdatedAt: oldSettings.workspace.updatedAt,
  });
  await owner
    .getByRole('dialog')
    .getByLabel('Ad', { exact: true })
    .fill('Çakışan ad');
  await owner
    .getByRole('dialog')
    .getByRole('button', { name: 'Kaydet', exact: true })
    .click();
  await owner.getByRole('dialog').getByRole('alert').waitFor();
  await owner
    .getByRole('dialog')
    .getByLabel('Pencereyi Kapat', { exact: true })
    .click();
  await owner
    .getByText(`Eşzamanlı Demo ${suffix}`, { exact: true })
    .first()
    .waitFor();
  await owner
    .getByLabel('Çalışma alanı adını düzenle', { exact: true })
    .click();
  await owner
    .getByRole('dialog')
    .getByLabel('Ad', { exact: true })
    .fill('PulseDesk Demo 7');
  await save(owner);
  await owner
    .getByLabel('Çalışma Alanını Değiştir, geçerli alan: PulseDesk Demo 7', {
      exact: true,
    })
    .waitFor();
  await owner.getByLabel('Görünen adını düzenle', { exact: true }).click();
  await owner
    .getByRole('dialog')
    .getByLabel('Ad', { exact: true })
    .fill('Yusuf Demo');
  await save(owner);
  await owner
    .locator('.sidebar-user strong')
    .getByText('Yusuf Demo', { exact: true })
    .waitFor();
  assert.equal(await owner.locator('input[type="email"]').count(), 0);
  const stored = await owner.evaluate(() =>
    JSON.parse(sessionStorage.getItem('pulsedesk.session.v1')),
  );
  assert.equal(
    (await owner.locator('body').innerText()).includes(stored.accessToken),
    false,
  );
  assert.equal(
    (await owner.locator('body').innerText()).includes(stored.refreshToken),
    false,
  );
  await owner.screenshot({
    path: join(artifacts, 'settings.png'),
    fullPage: true,
  });
  // Missing policy, empty states and tenant cleanup in a second owned workspace.
  const sandbox = await db.organization.create({
    data: {
      name: `Phase7 Boş Alan ${suffix}`,
      slug: `phase7-browser-${suffix}`,
    },
  });
  sandboxId = sandbox.id;
  await db.organizationMember.create({
    data: {
      organizationId: sandbox.id,
      userId: demoId('user:OWNER'),
      role: 'OWNER',
    },
  });
  await owner
    .getByLabel('Çalışma Alanını Değiştir, geçerli alan: PulseDesk Demo 7', {
      exact: true,
    })
    .click();
  await owner
    .getByRole('button', { name: new RegExp(`Phase7 Boş Alan ${suffix}`) })
    .click();
  await owner.waitForURL(base + '/app/dashboard');
  await navigate(owner, '/app/customers');
  await owner
    .getByRole('heading', { name: 'Henüz müşteri yok.', exact: true })
    .waitFor();
  assert.equal(
    (await owner.locator('body').innerText()).includes(
      `Yeni Müşteri ${suffix}`,
    ),
    false,
  );
  await navigate(owner, '/app/teams');
  await owner
    .getByRole('heading', { name: 'Henüz ekip oluşturulmamış.', exact: true })
    .waitFor();
  await navigate(owner, '/app/sla-policies');
  const low = owner.locator('.policy-group').filter({
    has: owner.getByRole('heading', { name: 'Düşük Öncelik', exact: true }),
  });
  await low
    .getByRole('button', { name: 'Politika Oluştur', exact: true })
    .click();
  await save(owner);
  await low.getByText('Etkin', { exact: true }).waitFor();
  await owner
    .getByRole('button', {
      name: new RegExp(
        `Çalışma Alanını Değiştir, geçerli alan: Phase7 Boş Alan ${suffix}`,
      ),
    })
    .click();
  await owner.getByRole('button', { name: /PulseDesk Demo 7/ }).click();
  await owner.waitForURL(base + '/app/dashboard');
  // Native navigation and all six new routes at the requested widths.
  const routes = [
    '/app/customers',
    `/app/customers/${createdCustomerId}`,
    '/app/teams',
    `/app/teams/${createdTeamId}`,
    '/app/sla-policies',
    '/app/settings',
  ];
  for (const width of [1440, 1024, 768, 430, 390, 375, 320]) {
    await owner.setViewportSize({ width, height: 950 });
    for (const path of routes) {
      await navigate(owner, path);
      await owner.waitForTimeout(300);
      assert.equal(
        await owner.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${width}px ${path} overflow`,
      );
    }
  }
  await owner.screenshot({
    path: join(artifacts, 'mobile-settings.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Phase 7 browser passed: demo OWNER/MANAGER/AGENT/VIEWER, customer/team CRUD and memberships, duplicate prevention, live scoped statistics, SLA management/history/units, settings/concurrency, tenant switches, empty states and 42 responsive route checks.',
  );
} catch (error) {
  for (const [role, page] of Object.entries(pages))
    await page
      .screenshot({
        path: join(artifacts, `${role}-failure.png`),
        fullPage: true,
      })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await db.$transaction(async (tx) => {
    const tickets = await tx.ticket.findMany({
        where: { organizationId, customerId: { in: customerIds } },
        select: { id: true },
      }),
      ticketIds = tickets.map((row) => row.id);
    const events = await tx.slaEvent.findMany({
      where: { organizationId, ticketId: { in: ticketIds } },
      select: { id: true },
    });
    const notifications = await tx.notification.findMany({
      where: { organizationId, entityId: { in: ticketIds } },
      select: { id: true },
    });
    await tx.outboxEvent.deleteMany({
      where: {
        organizationId,
        OR: [
          { ticketId: { in: ticketIds } },
          { slaEventId: { in: events.map((row) => row.id) } },
          { notificationId: { in: notifications.map((row) => row.id) } },
        ],
      },
    });
    await tx.notification.deleteMany({
      where: { organizationId, id: { in: notifications.map((row) => row.id) } },
    });
    await tx.slaEvent.deleteMany({
      where: { organizationId, ticketId: { in: ticketIds } },
    });
    await tx.ticketComment.deleteMany({
      where: { organizationId, ticketId: { in: ticketIds } },
    });
    await tx.ticketStatusHistory.deleteMany({
      where: { organizationId, ticketId: { in: ticketIds } },
    });
    await tx.ticketAssignment.deleteMany({
      where: { organizationId, ticketId: { in: ticketIds } },
    });
    await tx.auditLog.deleteMany({
      where: {
        organizationId,
        entityId: {
          in: [
            ...ticketIds,
            ...customerIds,
            ...events.map((row) => row.id),
            ...(createdTeamId ? [createdTeamId] : []),
          ],
        },
      },
    });
    await tx.ticket.deleteMany({
      where: { organizationId, id: { in: ticketIds } },
    });
    await tx.customer.deleteMany({
      where: { organizationId, id: { in: customerIds } },
    });
    if (createdTeamId) {
      await tx.teamMember.deleteMany({
        where: { organizationId, teamId: createdTeamId },
      });
      await tx.team.deleteMany({
        where: { organizationId, id: createdTeamId },
      });
    }
    await tx.slaPolicy.update({
      where: { id: savedPolicy.id },
      data: {
        name: savedPolicy.name,
        firstResponseMinutes: savedPolicy.firstResponseMinutes,
        resolutionMinutes: savedPolicy.resolutionMinutes,
        isActive: savedPolicy.isActive,
      },
    });
    await tx.organization.update({
      where: { id: organizationId },
      data: { name: savedOrg.name },
    });
    await tx.user.update({
      where: { id: savedOwner.id },
      data: { name: savedOwner.name },
    });
    if (sandboxId) {
      await tx.auditLog.deleteMany({ where: { organizationId: sandboxId } });
      await tx.slaPolicy.deleteMany({ where: { organizationId: sandboxId } });
      await tx.organizationMember.deleteMany({
        where: { organizationId: sandboxId },
      });
      await tx.organization.delete({ where: { id: sandboxId } });
    }
  });
  await db.onApplicationShutdown();
  console.log(`Phase 7 browser screenshots: ${artifacts}`);
}
