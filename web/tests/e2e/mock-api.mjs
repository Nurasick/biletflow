// A small in-memory BiletFlow API for browser tests. It answers the requests the
// pages make with the same shapes as docs/openapi.json, keeps state across a
// journey (orders, cases, disputes), and records every call so tests can assert
// on what the UI sent. Unknown routes answer 404 and are listed in `unhandled`.

const NOW = new Date('2026-11-24T09:00:00Z');
const iso = (offsetHours = 0) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString();

export const USERS = {
  attendee: { id: 3, email: 'attendee@example.com', first_name: 'Aru', last_name: 'Attendee' },
  organizer: { id: 2, email: 'organizer@example.com', first_name: 'Olzhas', last_name: 'Organizer', is_organizer: true },
  admin: { id: 1, email: 'admin@example.com', first_name: 'Aisha', last_name: 'Admin', is_platform_admin: true },
};

const user = (role) => role && {
  status: 'active', is_email_verified: true, locale: 'en', created_at: iso(-24 * 90),
  is_platform_admin: false, is_organizer: false, ...USERS[role],
};

const baseEvent = {
  id: 7, slug: 'jazz-night', title: 'Almaty Jazz Night', description: 'An evening of live jazz in the city centre.',
  category: 'concert', cover_image_url: null, status: 'published', phase: 'upcoming', visibility: 'public',
  venue_name: 'Palace of the Republic', venue_address: 'Dostyk Ave 56, Almaty', starts_at: iso(24 * 10),
  ends_at: iso(24 * 10 + 3), timezone: 'Asia/Almaty', capacity: 300, registration_opens_at: null,
  registration_closes_at: null, refund_policy: 'Refunds until 48 hours before the start.', published_at: iso(-24 * 30),
  cancelled_at: null, updated_at: iso(-24), organizer_profile_id: 5, seating_mode: 'general_admission', created_at: iso(-24 * 40),
};

const ticketType = {
  id: 11, name: 'Standard', description: 'General admission', price_minor: 500_000, currency: 'KZT',
  sales_start_at: null, sales_end_at: null, max_per_order: 6, available: 120,
};

export const CAMPAIGN_TOKEN = 'campaign-student20';

export function createState({ role = null } = {}) {
  return {
    role,
    event: { ...baseEvent },
    orders: new Map(),
    cases: new Map(),
    disputes: [],
    notifications: [
      { id: 501, template_key: 'support.status', payload: { case_number: 'SC-261120-OLD001', status: 'Resolved', status_key: 'resolved' }, read_at: null, created_at: iso(-5) },
      { id: 500, template_key: 'order.confirmed', payload: { order_number: 'BF-0999', event_title: baseEvent.title }, read_at: null, created_at: iso(-30) },
    ],
    calls: [],
    unhandled: [],
  };
}

const orderFrom = (state, number, { paid }) => {
  const draft = state.orders.get(number);
  const tickets = paid ? Array.from({ length: draft.quantity }, (_, index) => ({
    public_code: `BF-T${index + 1}`, ticket_type_id: ticketType.id, ticket_type_name: ticketType.name, status: 'valid',
    attendee_name: draft.contact_name, qr_payload: `bf1.signed.${number}.${index + 1}`,
  })) : [];
  return {
    order_number: number, event_id: state.event.id,
    event: Object.fromEntries(['slug', 'title', 'venue_name', 'venue_address', 'starts_at', 'ends_at', 'timezone', 'status']
      .map((key) => [key, state.event[key]])),
    status: paid ? 'confirmed' : 'pending', contact_name: draft.contact_name, contact_email: draft.contact_email,
    subtotal_minor: draft.subtotal, discount_minor: draft.discount, fee_minor: 0, total_minor: draft.subtotal - draft.discount,
    currency: 'KZT', expires_at: paid ? null : iso(0.25), confirmed_at: paid ? iso() : null, created_at: iso(),
    promo_code: draft.discount ? 'STUDENT20' : null,
    items: [{ id: 1, ticket_type_id: ticketType.id, quantity: draft.quantity, unit_price_minor: ticketType.price_minor,
      discount_minor: draft.discount, subtotal_minor: draft.subtotal }],
    tickets,
  };
};

const staffCase = (supportCase) => ({ ...supportCase, context: {
  event_id: supportCase.event_id, event_title: baseEvent.title, order_number: supportCase.order_number ?? null, ticket_code: null,
} });

const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

/** What the requester sees: no staff-only fields and no internal notes. */
const requesterCase = (supportCase) => {
  const rest = omit(staffCase(supportCase), ['contact_email', 'opened_by_user_id', 'assigned_to_user_id', 'event_id',
    'is_escalated', 'escalated_at', 'escalated_by_user_id', 'escalation_reason', 'order_number']);
  return { ...rest, messages: rest.messages.filter((message) => !message.is_internal_note)
    .map(({ id, sender, body, created_at }) => ({ id, sender, body, created_at })) };
};

/** Puts an existing support case in the mock, as if a requester had opened it. */
export function addCase(state, fields = {}) {
  const number = fields.case_number ?? `SC-261123-SEED${String(state.cases.size + 1).padStart(2, '0')}`;
  state.cases.set(number, {
    case_number: number, audience: 'attendee', category: 'ticket_delivery', status: 'open',
    created_at: iso(-3), updated_at: iso(-3), resolved_at: null, contact_email: 'guest@example.com',
    opened_by_user_id: null, assigned_to_user_id: null, event_id: baseEvent.id, order_number: 'BF-0999',
    is_escalated: false, escalated_at: null, escalated_by_user_id: null, escalation_reason: null,
    messages: [{ id: 1, sender: 'requester', body: 'I was charged twice for one ticket.', created_at: iso(-3),
      author_user_id: null, is_internal_note: false }],
    attachments: [],
    ...fields,
  });
  return number;
}

/** Installs the mock on `page`. Pass `role` to start signed in as that user,
 * and `seed(state)` to add data before the first request. */
export async function mockApi(page, options = {}) {
  const state = createState(options);
  options.seed?.(state);
  if (state.role) {
    await page.addInitScript(() => {
      localStorage.setItem('biletflow.auth.csrf', 'csrf-fixture');
      localStorage.setItem('biletflow.auth.session', 'session-fixture');
    });
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();
    const body = request.postDataJSON?.() ?? null;
    state.calls.push({ method, path, search: url.search, body });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const empty = () => route.fulfill({ status: 204 });
    const file = (contentType, content) => route.fulfill({ status: 200, contentType, body: content });
    const notFound = () => { state.unhandled.push(`${method} ${path}`); return json({ detail: 'Not found' }, 404); };
    const me = user(state.role);

    // --- session -----------------------------------------------------------
    if (path === '/auth/refresh') return me ? json({ access_token: 'access-fixture', csrf_token: 'csrf-fixture' }) : json({ detail: 'Not signed in' }, 401);
    if (path === '/auth/login') {
      state.role = Object.keys(USERS).find((role) => USERS[role].email === body?.email) ?? 'attendee';
      return json({ access_token: 'access-fixture', csrf_token: 'csrf-fixture' });
    }
    if (path === '/auth/logout') { state.role = null; return empty(); }
    if (path === '/users/me') return me ? json(me) : json({ detail: 'Not signed in' }, 401);
    if (path === '/users/me/orders') return json([]);
    if (path === '/users/me/notifications') {
      return json({ unread: state.notifications.filter((item) => !item.read_at).length, items: state.notifications });
    }
    if (path === '/users/me/notifications/read' && method === 'POST') {
      for (const item of state.notifications) item.read_at ??= iso();
      return empty();
    }
    const readOne = path.match(/^\/users\/me\/notifications\/(\d+)\/read$/);
    if (readOne && method === 'POST') {
      const item = state.notifications.find((entry) => entry.id === Number(readOne[1]));
      if (!item) return notFound();
      item.read_at = iso();
      return empty();
    }

    // --- public events, promo, checkout ------------------------------------
    if (path === '/events') return json(state.event.status === 'published' ? [state.event] : []);
    if (path === `/events/${baseEvent.slug}`) {
      return json({ ...state.event, organizer_name: 'Olzhas Events', images: [], paid_sales_active: true });
    }
    if (path === `/events/${baseEvent.slug}/ticket-types`) return json([ticketType]);
    if (path === `/events/${baseEvent.slug}/promo`) {
      const subtotal = body.items.reduce((sum, line) => sum + line.quantity * ticketType.price_minor, 0);
      if (body.token !== CAMPAIGN_TOKEN && body.code !== 'STUDENT20') return json({ detail: 'This promo code is not valid' }, 422);
      return json({ code: 'STUDENT20', name: 'Student discount', subtotal_minor: subtotal,
        discount_minor: subtotal * 0.2, total_minor: subtotal * 0.8 });
    }
    if (path === `/events/${baseEvent.slug}/orders` && method === 'POST') {
      const quantity = body.items.reduce((sum, line) => sum + line.attendees.length, 0);
      const subtotal = quantity * ticketType.price_minor;
      const discounted = body.campaign_token === CAMPAIGN_TOKEN || body.promo_code === 'STUDENT20';
      const number = `BF-${1000 + state.orders.size + 1}`;
      state.orders.set(number, { quantity, subtotal, discount: discounted ? subtotal * 0.2 : 0,
        contact_name: body.contact_name, contact_email: body.contact_email, paid: false });
      return json({ ...orderFrom(state, number, { paid: false }), access_token: `order-token-${number}` }, 201);
    }
    const orderMatch = path.match(/^\/orders\/(BF-\d+)(?:\/(.*))?$/);
    if (orderMatch && state.orders.has(orderMatch[1])) {
      const [, number, action] = orderMatch;
      const draft = state.orders.get(number);
      if (!action) return json(orderFrom(state, number, { paid: draft.paid }));
      if (action === 'pay' && method === 'POST') { draft.paid = true; return json(orderFrom(state, number, { paid: true })); }
      if (action.endsWith('.pdf')) return file('application/pdf', '%PDF-1.4\n% BiletFlow test ticket\n');
    }

    // --- support: requester side --------------------------------------------
    if (path === '/support/cases' && method === 'POST') {
      const number = `SC-261124-E2E${String(state.cases.size + 1).padStart(3, '0')}`;
      state.cases.set(number, {
        case_number: number, audience: body.audience, category: body.category, status: 'open',
        created_at: iso(), updated_at: iso(), resolved_at: null,
        contact_email: me?.email ?? body.contact_email, opened_by_user_id: me?.id ?? null,
        assigned_to_user_id: null, event_id: body.event_id ?? state.event.id, order_number: body.order_number ?? null,
        is_escalated: false, escalated_at: null, escalated_by_user_id: null, escalation_reason: null,
        messages: [{ id: 1, sender: 'requester', body: body.body, created_at: iso(), author_user_id: me?.id ?? null, is_internal_note: false }],
        attachments: [],
      });
      return json({ ...requesterCase(state.cases.get(number)), access_token: me ? null : `case-token-${number}` }, 201);
    }
    if (path === '/support/cases' && method === 'GET') return json([...state.cases.values()].map(requesterCase));
    const requester = path.match(/^\/support\/cases\/([^/]+)(?:\/(messages|attachments))?(?:\/(\d+))?$/);
    if (requester && state.cases.has(decodeURIComponent(requester[1]))) {
      const supportCase = state.cases.get(decodeURIComponent(requester[1]));
      if (requester[2] === 'messages' && method === 'POST') {
        supportCase.messages.push({ id: supportCase.messages.length + 1, sender: 'requester', body: body.body, created_at: iso(),
          author_user_id: me?.id ?? null, is_internal_note: false });
        if (supportCase.status === 'waiting_for_customer') supportCase.status = 'in_progress';
      }
      return json(requesterCase(supportCase));
    }

    // --- support: staff side -------------------------------------------------
    if (path === '/staff/events') {
      return json(me?.is_organizer ? [{ ...Object.fromEntries(['id', 'slug', 'title', 'venue_name', 'starts_at', 'ends_at', 'timezone', 'status']
        .map((key) => [key, state.event[key]])), role: 'organizer' }] : []);
    }
    if (path === '/staff/support/cases' && method === 'GET') {
      const params = url.searchParams;
      const rows = [...state.cases.values()].filter((supportCase) =>
        (!params.get('status') || supportCase.status === params.get('status'))
        && (!params.get('audience') || supportCase.audience === params.get('audience'))
        && (params.get('escalated') !== 'true' || supportCase.is_escalated)
        && (!params.get('q') || supportCase.case_number.includes(params.get('q')) || supportCase.contact_email.includes(params.get('q'))));
      return json(rows.map((row) => omit(row, ['messages', 'attachments', 'order_number'])));
    }
    const staff = path.match(/^\/staff\/support\/cases\/([^/]+)(?:\/(messages|escalate|attachments))?$/);
    if (staff && state.cases.has(decodeURIComponent(staff[1]))) {
      const supportCase = state.cases.get(decodeURIComponent(staff[1]));
      if (staff[2] === 'messages' && method === 'POST') {
        supportCase.messages.push({ id: supportCase.messages.length + 1, sender: 'staff', body: body.body, created_at: iso(),
          author_user_id: me.id, is_internal_note: body.is_internal_note });
        if (!body.is_internal_note && supportCase.status !== 'resolved') supportCase.status = 'waiting_for_customer';
      }
      if (!staff[2] && method === 'PATCH') {
        if ('assigned_to_user_id' in body) {
          supportCase.assigned_to_user_id = body.assigned_to_user_id;
          if (body.assigned_to_user_id && supportCase.status === 'open') supportCase.status = 'in_progress';
        }
        if (body.status) supportCase.status = body.status;
      }
      if (staff[2] === 'escalate' && method === 'POST') {
        Object.assign(supportCase, { is_escalated: true, escalated_at: iso(), escalated_by_user_id: me.id, escalation_reason: body.reason });
      }
      if (staff[2] === 'attachments' && method === 'POST') {
        const attachment = { id: 900 + supportCase.attachments.length, support_message_id: null, filename: body.filename,
          content_type: body.data_url.slice(5, body.data_url.indexOf(';')), size_bytes: 68, created_at: iso(),
          download_url: `/api/v1/staff/support/cases/${supportCase.case_number}/attachments/${900 + supportCase.attachments.length}` };
        supportCase.attachments.push(attachment);
        return json(attachment, 201);
      }
      supportCase.updated_at = iso();
      return json(staffCase(supportCase));
    }
    const staffFile = path.match(/^\/staff\/support\/cases\/[^/]+\/attachments\/(\d+)$/);
    if (staffFile) {
      return route.fulfill({ status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    }
    if (path === `/organizer/events/${baseEvent.id}/staff`) {
      return json([{ user_id: 4, email: 'staff@example.com', first_name: 'Sanzhar', last_name: 'Staff' }]);
    }

    // --- organizer dashboard -------------------------------------------------
    if (path === '/organizer/events') return json([state.event]);
    if (path === '/organizer/profile') {
      return json({ id: 5, display_name: 'Olzhas Events', contact_email: USERS.organizer.email, contact_phone: null,
        description: null, verification_status: 'verified', payout_account: null });
    }

    // --- admin ----------------------------------------------------------------
    if (path === '/admin/overview') {
      return json({ users: 42, organizers: 6, events_published: 9, events_suspended: state.event.status === 'suspended' ? 1 : 0,
        orders_confirmed: 120, tickets_issued: 260, gross_minor: 98_000_000, refunds_minor: 1_500_000, payments_failed: 3,
        open_reports: 1, open_support_cases: 2, open_disputes: state.disputes.filter((item) => item.status === 'open').length,
        is_simulated: true });
    }
    if (path === '/admin/events') {
      const status = url.searchParams.get('status');
      return json(!status || status === state.event.status ? [state.event] : []);
    }
    const adminEvent = path.match(/^\/admin\/events\/7\/(suspend|unsuspend|activation|timeline)$/);
    if (adminEvent) {
      const [, action] = adminEvent;
      if (action === 'suspend') { state.event = { ...state.event, status: 'suspended', phase: 'suspended' }; return json(state.event); }
      if (action === 'unsuspend') { state.event = { ...state.event, status: 'published', phase: 'upcoming' }; return json(state.event); }
      if (action === 'activation') return json({ detail: 'This event has no activation record' }, 404);
      return json([{ id: 1, created_at: iso(-2), actor_user_id: 2, actor_name: 'Olzhas Organizer', action: 'event.published',
        entity_type: 'event', entity_id: 7, summary: 'Event published', payload: null }]);
    }
    if (path === '/admin/payments') {
      const q = url.searchParams.get('q');
      const payment = { id: 77, purpose: 'ticket_order', status: 'succeeded', amount_minor: 800_000, currency: 'KZT', provider: 'simulated',
        provider_ref: 'sim_abc123', is_simulated: true, failure_reason: null, order_number: 'BF-0999', event_id: 7, created_at: iso(-30) };
      return json(!q || ['BF-0999', 'sim_abc123', '77'].some((value) => value.includes(q)) ? [payment] : []);
    }
    if (path.startsWith('/admin/exports/') && path.endsWith('.csv')) return file('text/csv', 'id,name\n1,example\n');
    if (path === '/admin/disputes' && method === 'GET') {
      const status = url.searchParams.get('status');
      return json(state.disputes.filter((item) => !status || item.status === status));
    }
    if (path === '/admin/disputes' && method === 'POST') {
      const dispute = { id: state.disputes.length + 1, order_id: 99, order_number: body.order_number, event_id: 7, event_title: baseEvent.title,
        payment_id: body.payment_id ?? null, status: 'open', reason: body.reason, amount_minor: body.amount_minor ?? 800_000, currency: 'KZT',
        evidence_notes: body.evidence_notes ?? null, resolution_notes: null, opened_by_user_id: me.id, resolved_by_user_id: null,
        resolved_at: null, created_at: iso(), updated_at: iso() };
      state.disputes.unshift(dispute);
      return json(dispute, 201);
    }
    const disputeMatch = path.match(/^\/admin\/disputes\/(\d+)$/);
    if (disputeMatch && method === 'PATCH') {
      const dispute = state.disputes.find((item) => item.id === Number(disputeMatch[1]));
      Object.assign(dispute, body, { updated_at: iso() });
      return json(dispute);
    }

    return notFound();
  });
  return state;
}
