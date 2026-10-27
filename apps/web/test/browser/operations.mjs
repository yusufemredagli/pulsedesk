import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const req = createRequire(
  new URL('../../../api/package.json', import.meta.url),
);
req('reflect-metadata');
const { PrismaService } = req(
  './dist/infrastructure/database/prisma.service.js',
);
const { ConfigService } = req('@nestjs/config');
const { createNotifications } = req(
  './dist/infrastructure/outbox/realtime-records.js',
);
assert.ok(
  process.env.TEST_DATABASE_URL &&
    process.env.TEST_DATABASE_URL === process.env.DATABASE_URL,
  'Set DATABASE_URL and TEST_DATABASE_URL to the same dedicated migrated test database used by the test API.',
);
const artifacts = mkdtempSync(join(tmpdir(), 'pulsedesk-product-browser-'));
const db = new PrismaService(
  new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
);
await db.onModuleInit();
const base = process.env.BROWSER_WEB_URL ?? 'http://localhost:3400',
  api = process.env.BROWSER_API_URL ?? 'http://localhost:4400',
  password = 'Phase six isolated test passphrase';
const suffix = randomUUID();
async function call(path, actor, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(api + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(actor
        ? {
            authorization: `Bearer ${actor.accessToken}`,
            'x-organization-id': actor.org,
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(r.ok, `${method} ${path}: ${r.status}`);
  return r.status === 204 ? null : r.json();
}
const manager = await call('/auth/register', null, {
  name: 'Alex Manager',
  email: `manager-${suffix}@example.invalid`,
  password,
  organizationName: 'Signal Support',
});
manager.org = manager.memberships[0].organizationId;
const agent = await call('/auth/register', null, {
  name: 'Zeynep Agent',
  email: `agent-${suffix}@example.invalid`,
  password,
  organizationName: 'Agent Personal',
});
agent.org = manager.org;
const agentMember = await db.organizationMember.create({
  data: { organizationId: manager.org, userId: agent.user.id, role: 'AGENT' },
});
const viewerOrg = await db.organization.create({
  data: { name: 'Read Only North', slug: `north-${suffix}` },
});
await db.organizationMember.create({
  data: {
    organizationId: viewerOrg.id,
    userId: manager.user.id,
    role: 'VIEWER',
  },
});
const customer = await call('/customers', manager, {
  name: 'Acme Systems',
  email: 'acme@example.invalid',
});
const team = await call('/teams', manager, { name: 'Customer Response' });
await call(`/teams/${team.id}/members`, manager, {
  membershipId: agentMember.id,
});
await db.slaPolicy.create({
  data: {
    organizationId: manager.org,
    name: 'Urgent coverage',
    priority: 'URGENT',
    firstResponseMinutes: 20,
    resolutionMinutes: 120,
  },
});
await db.$transaction(async (tx) => {
  await tx.ticket.createMany({
    data: Array.from({ length: 21 }, (_, index) => ({
      organizationId: manager.org,
      customerId: customer.id,
      ticketNumber: index + 1,
      subject: `Queue sample ${String(index + 1).padStart(2, '0')}`,
      description: 'Browser pagination fixture',
      status: 'OPEN',
      priority: 'LOW',
      source: 'WEB',
    })),
  });
  await tx.organizationTicketCounter.create({
    data: { organizationId: manager.org, lastNumber: 21 },
  });
});
await db.organizationMember.update({
  where: { id: manager.memberships[0].membershipId },
  data: { role: 'MANAGER' },
});
const browser = await chromium.launch({ headless: true });
const c1 = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'tr-TR',
  }),
  c2 = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'tr-TR',
  });
const page = await c1.newPage(),
  other = await c2.newPage();
const errors = [];
for (const p of [page, other]) {
  p.setDefaultTimeout(20000);
  p.on('pageerror', (e) => errors.push(e.message));
}
async function login(p, email) {
  await p.goto(base + '/login');
  await p.getByLabel('İş e-postası', { exact: true }).fill(email);
  await p.getByLabel('Şifre', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
  await p.waitForURL(base + '/select-organization');
  await p.getByRole('button', { name: /Signal Support/ }).click();
  await p.waitForURL(base + '/app/dashboard');
  await p.getByText('Canlı bağlantı etkin', { exact: true }).waitFor();
}
async function command(p, label) {
  await p.getByRole('button', { name: label, exact: true }).first().click();
  await p
    .getByRole('dialog')
    .getByRole('button', { name: label, exact: true })
    .click();
  await p.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function noOverflow(p, width, path) {
  await p.setViewportSize({ width, height: 950 });
  const destination = path.startsWith('/app/tickets/') ? '/app/tickets' : path;
  if (new URL(p.url()).pathname !== path) {
    if (new URL(p.url()).pathname !== destination) {
      let link = p.locator(`.sidebar a[href="${destination}"]`);
      if (!(await link.isVisible())) {
        const menu = p.locator('.mobile-menu details');
        if (!(await menu.evaluate((element) => element.open)))
          await p.getByLabel('Gezinmeyi Aç', { exact: true }).click();
        link = p.locator(`.mobile-menu a[href="${destination}"]`);
      }
      await link.click();
      await p.waitForURL(base + destination);
    }
    if (path !== destination) {
      await p.locator(`.ticket-table a[href="${path}"]`).click();
      await p.waitForURL(base + path);
    }
  }
  await p.locator('.ops-heading').waitFor();
  await p.waitForTimeout(500);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${width}px ${path} overflow`,
  );
}
try {
  for (const [route, heading] of [
    ['/login', 'Tekrar hoş geldin.'],
    ['/register', 'Daha iyi destek için yer açın.'],
  ]) {
    await page.goto(base + route);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    await page.getByLabel('İş e-postası', { exact: true }).waitFor();
    await page.getByLabel('Şifre', { exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'tr');
    assert.equal(
      /Welcome back|Work email|Sign in|Create workspace|At least 10/.test(
        await page.locator('body').innerText(),
      ),
      false,
    );
    await page.screenshot({
      path: join(artifacts, route.slice(1) + '.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page
    .getByRole('button', { name: 'Çalışma Alanı Oluştur', exact: true })
    .click();
  await page
    .getByText('Geçerli bir iş e-postası adresi girin.', { exact: true })
    .waitFor();
  assert.equal(
    await page.getByText('1–100 karakter girin.', { exact: true }).count(),
    2,
  );
  await login(page, manager.user.email);
  await login(other, agent.user.email);
  await page.getByRole('heading', { name: 'Operasyon Merkezi' }).waitFor();
  await page
    .locator('.metric')
    .first()
    .locator('strong')
    .filter({ hasText: /^21$/ })
    .waitFor();
  await other.getByRole('heading', { name: 'Bekleyen talep yok' }).waitFor();
  await page.goto(base + '/app/tickets');
  await page.getByRole('button', { name: '＋ Yeni Talep Oluştur' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Müşteri seçin', { exact: true })
    .selectOption(customer.id);
  await dialog
    .getByLabel('Konu', { exact: true })
    .fill('Checkout fails for enterprise customer');
  await dialog
    .getByLabel('Açıklama', { exact: true })
    .fill(
      'Customer reports a payment error. Coordinate a response and track the resolution.',
    );
  await dialog.getByLabel('Öncelik', { exact: true }).selectOption('URGENT');
  await dialog
    .getByRole('button', { name: 'Yeni Talep Oluştur', exact: true })
    .click();
  await page.waitForURL(/\/app\/tickets\/[0-9a-f-]+$/);
  const ticketId = page.url().split('/').at(-1);
  await page
    .getByRole('heading', { name: 'Checkout fails for enterprise customer' })
    .waitFor();
  await page.getByText('Riskte · 20 dk', { exact: true }).first().waitFor();
  await command(page, 'İncele');
  await page.getByRole('button', { name: 'Ata', exact: true }).first().click();
  await page
    .getByRole('dialog')
    .getByLabel('Ekip seçin', { exact: true })
    .selectOption(team.id);
  await page
    .getByRole('dialog')
    .getByLabel('Kişi seçin', { exact: true })
    .selectOption(agentMember.id);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Ata', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await other
    .locator('.metric')
    .first()
    .locator('strong')
    .filter({ hasText: /^1$/ })
    .waitFor();
  await other
    .locator('.activity-feed')
    .getByText('atandı: Zeynep Agent', { exact: true })
    .waitFor();
  await other.goto(base + `/app/tickets/${ticketId}`);
  await other.getByRole('button', { name: 'Başlat', exact: true }).waitFor();
  assert.equal(
    await other.getByRole('button', { name: 'Ata', exact: true }).count(),
    0,
  );
  await page.goto(base + '/app/tickets');
  await command(other, 'Başlat');
  await page.locator('.ops-badge.in_progress').waitFor();
  await page.goto(base + `/app/tickets/${ticketId}`);
  await page.getByRole('button', { name: 'Çöz', exact: true }).waitFor();
  await other
    .getByLabel('Yorum', { exact: true })
    .fill('Investigating payment gateway logs.');
  await other
    .getByRole('button', { name: 'Dahili Not Ekle', exact: true })
    .dblclick();
  await page
    .getByText('Investigating payment gateway logs.', { exact: true })
    .waitFor();
  assert.equal(await db.ticketComment.count({ where: { ticketId } }), 1);
  await other.getByLabel('Görünürlük', { exact: true }).selectOption('PUBLIC');
  await other
    .getByLabel('Yorum', { exact: true })
    .fill('We are investigating and will update you shortly.');
  await other
    .getByRole('button', { name: 'Müşteriye Yanıt Ekle', exact: true })
    .click();
  await page
    .getByText('We are investigating and will update you shortly.', {
      exact: true,
    })
    .waitFor();
  // A dialog retains the reviewed version while another session advances the ticket.
  await page.getByRole('button', { name: 'Çöz', exact: true }).click();
  await command(other, 'Müşteriyi Bekle');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Çöz', exact: true })
    .click();
  await page
    .getByText(
      'Bu talep başka bir kullanıcı tarafından güncellendi. Güncel talebi inceleyip tekrar deneyin.',
      { exact: true },
    )
    .waitFor();
  await page.getByRole('button', { name: 'Devam Et', exact: true }).waitFor();
  await command(other, 'Devam Et');
  await page.getByRole('button', { name: 'Çöz', exact: true }).waitFor();
  await command(other, 'Çöz');
  await page.getByRole('button', { name: 'Kapat', exact: true }).waitFor();
  await command(page, 'Kapat');
  await page.locator('.ticket-header-meta .closed').waitFor();
  await other.locator('.ticket-header-meta .closed').waitFor();
  await page.screenshot({
    path: join(artifacts, 'detail.png'),
    fullPage: true,
  });
  // Detail 404, list filters and empty state.
  await page.goto(base + '/app/tickets/' + randomUUID());
  await page.getByText('Talep bulunamadı', { exact: true }).waitFor();
  await page.goto(base + '/app/tickets');
  await page
    .getByLabel('Taleplerde ara', { exact: true })
    .fill('does-not-exist');
  await page.getByRole('heading', { name: 'Talep bulunamadı' }).waitFor();
  await page.getByLabel('Taleplerde ara', { exact: true }).fill('');
  await page.getByRole('link', { name: /Checkout fails/ }).waitFor();
  await page.getByLabel('Durum', { exact: true }).selectOption('CANCELLED');
  await page.getByRole('heading', { name: 'Talep bulunamadı' }).waitFor();
  await page.getByLabel('Durum', { exact: true }).selectOption('');
  await page
    .locator('.table-pagination')
    .getByRole('button', { name: 'Sonraki', exact: true })
    .click();
  await page.getByText('22 talep · Sayfa 2 / 2', { exact: true }).waitFor();
  await page.route(api + '/tickets/' + ticketId, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Never display this remote body' }),
    }),
  );
  await page.goto(base + '/app/tickets/' + ticketId);
  await page.getByText('Erişim yetkiniz yok', { exact: true }).waitFor();
  assert.equal(
    (await page.locator('body').innerText()).includes('Never display'),
    false,
  );
  await page.unroute(api + '/tickets/' + ticketId);
  await page.route(api + '/tickets?**', (route) => route.abort());
  await page.goto(base + '/app/tickets');
  await page.getByText('Bu ekran yüklenemedi', { exact: true }).waitFor();
  await page.unroute(api + '/tickets?**');
  await page.getByRole('button', { name: 'Tekrar Dene', exact: true }).click();
  await page.getByRole('link', { name: /Checkout fails/ }).waitFor();
  await db.$transaction((tx) =>
    createNotifications(tx, [
      {
        organizationId: manager.org,
        recipientMemberId: manager.memberships[0].membershipId,
        type: 'SYSTEM',
        title: 'Response review needed',
        message: 'A persisted live alert for your workspace.',
      },
    ]),
  );
  await page.getByLabel('Bildirimler, 1 okunmamış', { exact: true }).waitFor();
  await page.getByLabel('Bildirimler, 1 okunmamış', { exact: true }).click();
  await page.getByText('Response review needed', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Okundu Olarak İşaretle', exact: true })
    .click();
  await page.getByLabel('Bildirimler, 0 okunmamış', { exact: true }).waitFor();
  await page.goto(base + '/app/dashboard');
  await page.getByRole('heading', { name: 'Operasyon Merkezi' }).waitFor();
  await page
    .locator('.metric')
    .first()
    .locator('strong')
    .filter({ hasText: /^21$/ })
    .waitFor();
  await page.locator('.ticket-table tbody tr').first().waitFor();
  await page.screenshot({
    path: join(artifacts, 'dashboard.png'),
    fullPage: true,
  });
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    for (const path of [
      '/app/dashboard',
      '/app/tickets',
      `/app/tickets/${ticketId}`,
    ])
      await noOverflow(page, width, path);
  }
  await page.screenshot({
    path: join(artifacts, 'detail-mobile.png'),
    fullPage: true,
  });
  // Viewer switch clears ticket state and hides writes.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', {
      name: 'Çalışma Alanını Değiştir, geçerli alan: Signal Support',
    })
    .click();
  await page.getByRole('button', { name: /Read Only North/ }).click();
  await page.waitForURL(base + '/app/dashboard');
  await page.getByRole('heading', { name: 'Bekleyen talep yok' }).waitFor();
  await page.goto(base + '/app/tickets');
  await page.getByRole('heading', { name: 'Henüz talep yok' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '＋ Yeni Talep Oluştur' }).count(),
    0,
  );
  assert.equal(
    (await page.locator('body').innerText()).includes('Checkout fails'),
    false,
  );
  // Offline realtime remains visibly degraded with HTTP usable.
  await other.setViewportSize({ width: 1440, height: 1000 });
  await c2.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await other.reload();
  await other
    .getByText('Canlı bağlantı kullanılamıyor', { exact: true })
    .waitFor({ timeout: 30000 });
  await other
    .getByRole('heading', { name: 'Checkout fails for enterprise customer' })
    .waitFor();
  await other.getByRole('button', { name: 'Yenile', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'Phase 6 browser passed: MANAGER + AGENT real login/selection; create/triage/team+member assign/start/internal+public comment/wait/409/resume/resolve/close; live cross-session reconciliation; duplicate prevention; search/status empty states; 404; bell live/read; VIEWER tenant isolation; degraded websocket + HTTP; all 18 viewport/route overflow checks.',
  );
} catch (error) {
  console.error(error);
  await other.screenshot({
    path: join(artifacts, 'agent-failure.png'),
    fullPage: true,
  });
  await page.screenshot({
    path: join(artifacts, 'failure.png'),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  const orgIds = [
    manager.org,
    agent.memberships[0].organizationId,
    viewerOrg.id,
  ];
  const userIds = [manager.user.id, agent.user.id];
  await db.$transaction(async (tx) => {
    const where = { organizationId: { in: orgIds } };
    await tx.outboxEvent.deleteMany({ where });
    await tx.notification.deleteMany({ where });
    await tx.slaEvent.deleteMany({ where });
    await tx.ticketComment.deleteMany({ where });
    await tx.ticketStatusHistory.deleteMany({ where });
    await tx.ticketAssignment.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.ticket.deleteMany({ where });
    await tx.slaPolicy.deleteMany({ where });
    await tx.organizationTicketCounter.deleteMany({ where });
    await tx.teamMember.deleteMany({ where });
    await tx.team.deleteMany({ where });
    await tx.customer.deleteMany({ where });
    await tx.organizationMember.deleteMany({ where });
    await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
  await db.onApplicationShutdown();
  console.log(`Browser screenshots: ${artifacts}`);
}
