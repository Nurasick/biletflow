const { test, expect } = require('@playwright/test');

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Unexpected text node|Attempted to navigate|Text strings must be rendered/.test(message.text())) errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

async function mockApi(page, { remembered = true, failAdmission = false } = {}) {
  const event = { id: 42, slug: 'qa-event', title: 'Assigned QA Event', venue_name: 'QA venue',
    starts_at: '2026-12-01T12:00:00Z', ends_at: '2026-12-01T14:00:00Z', timezone: 'Asia/Almaty', status: 'published', role: 'event_admin' };
  let checkedIn = false;
  let admissionCalls = 0;
  let nextId = 1;
  let supportCase = null;
  const ticket = () => ({ public_code: 'QA-TICKET', attendee_name: 'QA Attendee', ticket_type_name: 'General admission', status: checkedIn ? 'checked_in' : 'valid' });
  await page.addInitScript(({ remembered }) => {
    if (remembered) localStorage.setItem('biletflow.auth.session.v1', JSON.stringify({ email: 'qa@example.test', refreshToken: `fixture-${Date.now()}` }));
  }, { remembered });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/')) {
      if (path === '/auth/logout' || path === '/auth/password-reset/confirm' || path === '/auth/verify-email') return route.fulfill({ status: 204 });
      return send({ access_token: `fixture-access-${Date.now()}`, refresh_token: `fixture-refresh-${Date.now()}` });
    }
    if (path === '/events') return send([]);
    if (path === '/staff/events') return send([event]);
    if (path === '/staff/events/42/attendance') return send({ registered: 2, checked_in: Number(checkedIn), absent: 2 - Number(checkedIn), checked_in_percent: checkedIn ? 50 : 0 });
    if (path.startsWith('/staff/events/42/search')) return send([ticket()]);
    if (path.endsWith('/check-in')) {
      admissionCalls += 1;
      if (failAdmission) return route.abort('failed');
      const outcome = checkedIn ? 'already_used' : 'valid'; checkedIn = true;
      return send({ outcome, ticket: ticket() });
    }
    if (path.endsWith('/reverse')) { checkedIn = false; return send(ticket()); }
    if (path === '/users/me') return send({ id: 7, email: 'qa@example.test', first_name: 'QA', last_name: 'User', phone: null, locale: 'en', is_email_verified: true, is_organizer: true });
    if (path === '/users/me/notifications') return send({ unread: 1, items: [{ id: 1, template_key: 'support.message', payload: { case_number: 'SC-QA' }, read_at: null, created_at: new Date().toISOString() }] });
    if (path === '/support/cases' && method === 'POST') {
      const body = request.postDataJSON();
      supportCase = { case_number: 'SC-QA', audience: body.audience, category: body.category, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), resolved_at: null,
        context: { event_id: body.event_id ?? null, event_title: 'Assigned QA Event', order_number: body.order_number ?? null, ticket_code: body.ticket_code ?? null },
        messages: [{ id: nextId++, sender: 'requester', body: body.body, created_at: new Date().toISOString() }] };
      return send(supportCase, 201);
    }
    if (path === '/support/cases') return send(supportCase ? [supportCase] : []);
    if (path === '/staff/support/cases') return send([]);
    if (path === '/support/cases/SC-QA/messages') {
      supportCase.messages.push({ id: nextId++, sender: 'requester', body: request.postDataJSON().body, created_at: new Date().toISOString() });
      return send(supportCase);
    }
    if (path === '/support/cases/SC-QA') return send(supportCase);
    return send({ detail: 'Not found in smoke-test fixture' }, 404);
  });
  return { admissionCalls: () => admissionCalls };
}

test('assigned staff can manually admit and explicitly reverse an attendee', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/staff');
  await expect(page.getByText('Assigned QA Event', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open check-in', exact: true }).click();
  await page.getByLabel('Name or ticket code').fill('QA');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText('Check-in confirmed', { exact: true })).toBeVisible();
  expect(api.admissionCalls()).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo check-in', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Scan next ticket', exact: true }).click();
  await page.getByRole('button', { name: 'Undo check-in', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reversal', exact: true }).click();
  await expect(page.getByText('Reversal complete', { exact: false })).toBeVisible();
});

test('an uncertain network result never presents successful admission', async ({ page }) => {
  const api = await mockApi(page, { failAdmission: true });
  await page.goto('/staff-event?eventId=42');
  await page.getByLabel('Name or ticket code').fill('QA');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText('Result unknown. Refresh attendance and search before trying again.', { exact: true })).toBeVisible();
  await expect(page.getByText('Check-in confirmed', { exact: true })).toHaveCount(0);
  expect(api.admissionCalls()).toBe(1);
});

test('support retains event/order/ticket context and sends a follow-up', async ({ page }) => {
  await mockApi(page);
  await page.goto('/support-new?eventId=42&orderNumber=ORDER-QA&ticketCode=QA-TICKET');
  await page.getByLabel('Describe the problem').fill('Please help with this ticket.');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByText('SC-QA', { exact: true })).toBeVisible();
  await expect(page.getByText('Please help with this ticket.', { exact: true })).toBeVisible();
  await expect(page.getByText('ORDER-QA', { exact: false })).toBeVisible();
  await page.getByLabel('Your message').fill('Here is some more context.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText('Here is some more context.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Internal note')).toHaveCount(0);
});

test('language selection updates and persists the staff interface', async ({ page }) => {
  await mockApi(page);
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Русский', exact: true }).click();
  await expect(page.getByText('Рабочая область', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Рабочая область', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Қазақша', exact: true }).click();
  await expect(page.getByText('Жұмыс кеңістігі', { exact: true })).toBeVisible();
});

test('unassigned events do not expose camera or admission actions', async ({ page }) => {
  await mockApi(page);
  await page.goto('/staff-event?eventId=999');
  await expect(page.getByText('Your access to this event is unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow camera', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);
});

test('password-reset completion is reachable without a session', async ({ page }) => {
  await mockApi(page, { remembered: false });
  await page.goto('/reset-password');
  await expect(page.getByLabel('Email token')).toBeVisible();
  await page.getByLabel('Email token').fill('test-fixture-token');
  await page.getByLabel('New password', { exact: true }).fill(`test-${Date.now()}`);
  await page.getByLabel('Repeat password').fill('different');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
});

test('signed-out login links navigate to reset and verification screens', async ({ page }) => {
  await mockApi(page, { remembered: false });
  await page.goto('/login');
  await page.getByText('Forgot password?', { exact: true }).click();
  await page.getByText('I have a reset token', { exact: true }).click();
  await expect(page.getByLabel('Email token')).toBeVisible();
  await page.goto('/login');
  await page.getByText('Verify email', { exact: true }).click();
  await expect(page.getByLabel('Email token')).toBeVisible();
});

test('sign-in mounts authenticated navigation and opens the staff workspace', async ({ page }) => {
  await mockApi(page, { remembered: false });
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('qa@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill(`fixture-${Date.now()}`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Find your next event', { exact: true })).toBeVisible();
  await page.getByText('Event staff · Support · Language', { exact: true }).click();
  await page.getByRole('button', { name: 'Open assigned events', exact: true }).click();
  await expect(page.getByText('Assigned QA Event', { exact: true })).toBeVisible();
});
