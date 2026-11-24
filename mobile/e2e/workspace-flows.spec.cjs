const { test, expect } = require('@playwright/test');

async function mockSignedInApi(page, responder) {
  await page.addInitScript(() => {
    sessionStorage.setItem('biletflow.auth.session.v1', JSON.stringify({ email: 'qa@example.test', refreshToken: 'qa-refresh' }));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') return route.fulfill({ json: { access_token: 'qa-access', refresh_token: 'qa-refresh-next' } });
    const response = await responder(path, request);
    if (!response) return route.fulfill({ status: 404, json: { detail: `Unmocked API: ${path}` } });
    return route.fulfill({ status: response.status ?? 200, json: response.body });
  });
}

const account = { id: 7, email: 'qa@example.test', first_name: 'QA', last_name: 'User', phone: null, locale: 'en', is_email_verified: true, is_organizer: false, is_platform_admin: false };

test('signed-in attendee can reserve a ticket from checkout', async ({ page }) => {
  await mockSignedInApi(page, (path, request) => {
    if (path === '/users/me') return { body: account };
    if (path === '/events/qa-event/ticket-types') return { body: [{ id: 3, name: 'General', price_minor: 2500, currency: 'KZT', available: 8, max_per_order: 4, sales_start_at: null, sales_end_at: null }] };
    if (path === '/events/qa-event/orders' && request.method() === 'POST') return { body: { order_number: 'ORDER-QA-MOBILE', status: 'pending', total_minor: 2500, fee_minor: 250, currency: 'KZT', expires_at: new Date(Date.now() + 600_000).toISOString() } };
    return null;
  });
  await page.goto('/checkout?slug=qa-event&selection=%7B%223%22%3A1%7D');
  await page.getByLabel('Contact name').fill('QA Buyer');
  await page.getByLabel('Contact email').fill('buyer@example.test');
  await page.getByLabel('General attendee 1').fill('QA Attendee');
  await page.getByRole('button', { name: 'Reserve tickets', exact: true }).click();
  await expect(page.getByText('ORDER-QA-MOBILE', { exact: false })).toBeVisible();
  await expect(page.getByText('Processing fee', { exact: false })).toBeVisible();
  await expect(page.getByText('Hold expires in', { exact: false })).toBeVisible();
});

test('campaign scanner entry is available to a signed-in attendee', async ({ page }) => {
  await mockSignedInApi(page, (path) => path === '/users/me' ? { body: account } : null);
  await page.goto('/campaign-scan');
  await expect(page.getByRole('heading', { name: 'Scan campaign QR', exact: true })).toBeVisible();
  await expect(page.getByText('Promotional campaign', { exact: true })).toBeVisible();
  await expect(page.getByText('Campaign QR codes never grant event admission.', { exact: false })).toBeVisible();
});

test('organizer can create an organizer profile from the mobile workspace', async ({ page }) => {
  let saved = false;
  await mockSignedInApi(page, (path, request) => {
    if (path === '/users/me') return { body: account };
    if (path === '/organizer/profile' && request.method() === 'GET') return saved
      ? { body: { id: 12, display_name: 'QA Organizer', contact_email: 'qa@example.test', contact_phone: null, description: null, verification_status: 'pending', payout_account: null } }
      : { status: 404, body: { detail: 'Organizer profile not found' } };
    if (path === '/organizer/profile' && request.method() === 'PUT') {
      saved = true;
      return { body: { id: 12, display_name: 'QA Organizer', contact_email: 'qa@example.test', contact_phone: null, description: null, verification_status: 'pending', payout_account: null } };
    }
    if (path === '/organizer/events') return { body: [] };
    return null;
  });
  await page.goto('/organizer');
  await page.getByLabel('Organization name').fill('QA Organizer');
  await page.getByLabel('Contact email').fill('qa@example.test');
  await page.getByRole('button', { name: 'Save organizer profile', exact: true }).click();
  await expect(page.getByText('Organizer profile saved.', { exact: true })).toBeVisible();
  await expect(page.getByText('Organizer profile', { exact: true })).toBeVisible();
});

test('platform admin mobile workspace loads and opens event management', async ({ page }) => {
  await mockSignedInApi(page, (path) => {
    if (path === '/users/me') return { body: { ...account, is_platform_admin: true } };
    if (path === '/admin/overview') return { body: { users: 3, organizers: 1, events_published: 1, events_suspended: 0, orders_confirmed: 1, tickets_issued: 1, gross_minor: 2500, refunds_minor: 0, payments_failed: 0, open_reports: 0, open_support_cases: 0, is_simulated: true } };
    if (path.startsWith('/admin/')) return { body: path === '/admin/settings' ? { activation_fee_minor: 1000, processing_fee_bps: 250 } : [] };
    return null;
  });
  await page.goto('/admin');
  await expect(page.getByText('Platform overview', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.getByLabel('Search by event, email, or name')).toBeVisible();
});
