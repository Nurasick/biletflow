import type { AuthenticatedFetch } from './orders';

async function request<T>(fetcher: AuthenticatedFetch, path: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(path, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status}).`);
  }
  return body as T;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.size ? `?${params}` : '';
};

export type ManagedEvent = {
  id: number; slug: string; title: string; description: string | null; category: string | null;
  cover_image_url: string | null; status: string; phase: string; visibility: string;
  venue_name: string; venue_address: string; starts_at: string; ends_at: string; timezone: string;
  capacity: number | null; registration_opens_at: string | null; registration_closes_at: string | null;
  seating_mode: 'general_admission'|'assigned';
  refund_policy: string | null; published_at: string | null; cancelled_at: string | null;
};
export type ManagedTicketType = {
  id: number; name: string; description: string | null; price_minor: number; currency: string;
  quantity_total: number; quantity_sold: number; quantity_reserved: number; sales_start_at: string | null;
  sales_end_at: string | null; max_per_order: number | null; is_hidden: boolean; position: number;
};
export type ManagedImage = { id: number; url: string; position: number };
export type OrganizerProfile = {
  id: number; display_name: string; contact_email: string; contact_phone: string | null;
  description: string | null; verification_status: string;
  payout_account: { provider: string; external_account_ref: string; status: string; is_simulated: boolean } | null;
};
export type Activation = {
  status: string; activation_fee_minor: number; currency: string; is_simulated: boolean;
  suspension_reason: string | null; checklist: Record<string, boolean>;
};
export type OrganizerSummary = {
  currency: string; is_simulated: boolean; capacity: number; tickets_sold: number; tickets_reserved: number;
  tickets_remaining: number; percent_sold: number; gross_minor: number; refunds_minor: number; fees_minor: number;
  net_minor: number; estimated_payout_minor: number; tickets_refunded: number;
  attendance: { registered: number; checked_in: number; absent: number; checked_in_percent: number };
  by_ticket_type: { ticket_type_id: number; name: string; price_minor: number; quantity_total: number; quantity_sold: number; quantity_reserved: number; revenue_minor: number }[];
};
export type OrganizerOrder = { order_number: string; status: string; contact_name: string; contact_email: string; total_minor: number; currency: string; ticket_count: number; created_at: string };
export type Attendee = { public_code: string; ticket_status: string; ticket_type_name: string; order_number: string; full_name: string; email: string | null; phone: string | null };
export type StaffMember = { user_id: number; email: string; first_name: string; last_name: string; role: string };
export type Campaign = { id: number; event_id: number; name: string; code: string; discount_type: 'percent'|'fixed'; discount_value: number; starts_at: string | null; ends_at: string | null; max_redemptions: number | null; redemption_count: number; is_active: boolean; ticket_type_ids: number[]; link: string; stats: { redemptions: number; orders: number; tickets_sold: number; gross_minor: number; discount_minor: number; refunds_minor: number; net_minor: number } };
export type EventAnalytics = { is_simulated: boolean; capacity: number; tickets_sold: number; tickets_remaining: number; percent_sold: number; gross_minor: number; discounts_minor: number; refunds_minor: number; net_minor: number; sales_over_time: { date: string; tickets: number; revenue_minor: number }[]; by_ticket_type: OrganizerSummary['by_ticket_type']; campaigns: (Campaign['stats'] & { id: number; name: string; code: string; is_active: boolean })[]; attendance: OrganizerSummary['attendance'] };
export type TimelineItem = { id: number; created_at: string; actor_user_id: number | null; actor_name?: string | null; action: string; entity_type: string; entity_id: number; summary: string; payload: Record<string, unknown> | null };
const eventBase = (id: number) => `/organizer/events/${id}`;

export const managementApi = {
  profile: (f: AuthenticatedFetch) => request<OrganizerProfile>(f, '/organizer/profile'),
  saveProfile: (f: AuthenticatedFetch, body: Record<string, unknown>) => request<OrganizerProfile>(f, '/organizer/profile', json('PUT', body)),
  verifyProfile: (f: AuthenticatedFetch) => request<OrganizerProfile>(f, '/organizer/profile/verify', json('POST')),
  events: (f: AuthenticatedFetch, signal?: AbortSignal) => request<ManagedEvent[]>(f, '/organizer/events', { signal }),
  createEvent: (f: AuthenticatedFetch, body: Record<string, unknown>) => request<ManagedEvent>(f, '/events', json('POST', body)),
  updateEvent: (f: AuthenticatedFetch, id: number, body: Record<string, unknown>) => request<ManagedEvent>(f, eventBase(id), json('PATCH', body)),
  images: (f: AuthenticatedFetch, id: number, signal?: AbortSignal) => request<ManagedImage[]>(f, `${eventBase(id)}/images`, { signal }),
  uploadImage: (f: AuthenticatedFetch, id: number, dataUrl: string) => request<ManagedImage>(f, `${eventBase(id)}/images`, json('POST', { data_url: dataUrl })),
  removeImage: (f: AuthenticatedFetch, id: number, imageId: number) => request<null>(f, `${eventBase(id)}/images/${imageId}`, { method:'DELETE' }),
  transition: (f: AuthenticatedFetch, id: number, action: 'publish'|'unpublish'|'cancel') => request<ManagedEvent>(f, `${eventBase(id)}/${action}`, json('POST')),
  duplicate: (f: AuthenticatedFetch, id: number) => request<ManagedEvent>(f, `${eventBase(id)}/duplicate`, json('POST')),
  ticketTypes: (f: AuthenticatedFetch, id: number, signal?: AbortSignal) => request<ManagedTicketType[]>(f, `${eventBase(id)}/ticket-types`, { signal }),
  createTicketType: (f: AuthenticatedFetch, id: number, body: Record<string, unknown>) => request<ManagedTicketType>(f, `${eventBase(id)}/ticket-types`, json('POST', body)),
  updateTicketType: (f: AuthenticatedFetch, id: number, ticketId: number, body: Record<string, unknown>) => request<ManagedTicketType>(f, `${eventBase(id)}/ticket-types/${ticketId}`, json('PATCH', body)),
  activation: (f: AuthenticatedFetch, id: number) => request<Activation>(f, `${eventBase(id)}/activation`),
  activationAction: (f: AuthenticatedFetch, id: number, action: 'terms'|'activate'|'fee', body?: unknown) => request<Activation>(f, `${eventBase(id)}/activation/${action}`, json('POST', body)),
  summary: (f: AuthenticatedFetch, id: number) => request<OrganizerSummary>(f, `${eventBase(id)}/summary`),
  orders: (f: AuthenticatedFetch, id: number, offset = 0) => request<OrganizerOrder[]>(f, `${eventBase(id)}/orders${query({limit:50,offset})}`),
  cancelOrder: (f: AuthenticatedFetch, id: number, order: string) => request<OrganizerOrder>(f, `${eventBase(id)}/orders/${encodeURIComponent(order)}/cancel`, json('POST')),
  refundOrder: (f: AuthenticatedFetch, id: number, order: string, reason: string) => request<OrganizerOrder>(f, `${eventBase(id)}/orders/${encodeURIComponent(order)}/refund`, json('POST', { reason })),
  attendees: (f: AuthenticatedFetch, id: number, offset = 0, signal?: AbortSignal) => request<Attendee[]>(f, `${eventBase(id)}/attendees${query({ limit: 100, offset })}`, { signal }),
  staff: (f: AuthenticatedFetch, id: number) => request<StaffMember[]>(f, `${eventBase(id)}/staff`),
  assignStaff: (f: AuthenticatedFetch, id: number, email: string) => request<StaffMember[]>(f, `${eventBase(id)}/staff`, json('POST', { email })),
  removeStaff: (f: AuthenticatedFetch, id: number, userId: number) => request<null>(f, `${eventBase(id)}/staff/${userId}`, { method: 'DELETE' }),
  campaigns: (f: AuthenticatedFetch, id: number) => request<Campaign[]>(f, `${eventBase(id)}/campaigns`),
  createCampaign: (f: AuthenticatedFetch, id: number, body: Record<string, unknown>) => request<Campaign>(f, `${eventBase(id)}/campaigns`, json('POST', body)),
  updateCampaign: (f: AuthenticatedFetch, id: number, campaignId: number, body: Record<string, unknown>) => request<Campaign>(f, `${eventBase(id)}/campaigns/${campaignId}`, json('PATCH', body)),
  analytics: (f: AuthenticatedFetch, id: number, filters: { since?: string; until?: string; ticket_type_id?: number } = {}) => request<EventAnalytics>(f, `${eventBase(id)}/analytics${query(filters)}`),
  timeline: (f: AuthenticatedFetch, id: number, filters: { since?: string; until?: string; action?: string } = {}) => {
    const params = new URLSearchParams({ limit:'100', offset:'0' });
    if (filters.since) params.set('since', filters.since);
    if (filters.until) params.set('until', filters.until);
    if (filters.action) params.append('action', filters.action);
    return request<TimelineItem[]>(f, `${eventBase(id)}/timeline?${params}`);
  },
};

export type AdminOverview = { users: number; organizers: number; events_published: number; events_suspended: number; orders_confirmed: number; tickets_issued: number; gross_minor: number; refunds_minor: number; payments_failed: number; open_reports: number; open_support_cases: number; is_simulated: boolean };
export type AdminUser = { id: number; email: string; first_name: string; last_name: string; status: string; is_email_verified: boolean; is_platform_admin: boolean; created_at: string };
export type AdminEvent = ManagedEvent & { organizer_profile_id: number; seating_mode: string; created_at: string };
export type EventReport = { id: number; event_id: number; event_title: string; event_slug: string; event_status: string; reason: string; details: string | null; status: string; created_at: string; resolved_at: string | null };
export type AdminSettings = { activation_fee_minor: number; processing_fee_bps: number };
const adminQuery = (limit = 50, offset = 0, q?: string) => query({ limit, offset, q });
export const adminManagementApi = {
  overview: (f: AuthenticatedFetch) => request<AdminOverview>(f, '/admin/overview'),
  events: (f: AuthenticatedFetch, q = '') => request<AdminEvent[]>(f, `/admin/events${adminQuery(50, 0, q)}`),
  orders: (f: AuthenticatedFetch, q = '', status?: string) => request<Record<string, unknown>[]>(f, `/admin/orders${query({ limit:50, offset:0, q, status })}`),
  payments: (f: AuthenticatedFetch, status?: string) => request<Record<string, unknown>[]>(f, `/admin/payments${query({ limit:50, offset:0, status })}`),
  refunds: (f: AuthenticatedFetch) => request<Record<string, unknown>[]>(f, `/admin/refunds${adminQuery()}`),
  activations: (f: AuthenticatedFetch) => request<Record<string, unknown>[]>(f, `/admin/activations${adminQuery()}`),
  campaigns: (f: AuthenticatedFetch) => request<Record<string, unknown>[]>(f, `/admin/campaigns${adminQuery()}`),
  eventAction: (f: AuthenticatedFetch, id: number, action: 'suspend'|'unsuspend'|'cancel', reason?: string) => request<AdminEvent>(f, `/admin/events/${id}/${action}`, action === 'unsuspend' ? json('POST') : json('POST', { reason })),
  activationAction: (f: AuthenticatedFetch, id: number, action: 'suspend'|'reinstate', reason?: string) => request<Record<string, unknown>>(f, `/admin/events/${id}/activation/${action}`, action === 'suspend' ? json('POST', { reason }) : json('POST')),
  eventTimeline: (f: AuthenticatedFetch, id: number) => request<TimelineItem[]>(f, `/admin/events/${id}/timeline?limit=100&offset=0`),
  users: (f: AuthenticatedFetch, q = '') => request<AdminUser[]>(f, `/admin/users${adminQuery(50, 0, q)}`),
  userAction: (f: AuthenticatedFetch, id: number, action: 'suspend'|'unsuspend', reason?: string) => request<AdminUser>(f, `/admin/users/${id}/${action}`, action === 'unsuspend' ? json('POST') : json('POST', { reason })),
  reports: (f: AuthenticatedFetch, status = 'open') => request<EventReport[]>(f, `/admin/reports${query({ limit: 50, offset: 0, status })}`),
  resolveReport: (f: AuthenticatedFetch, id: number, status: 'dismissed'|'actioned') => request<EventReport>(f, `/admin/reports/${id}/resolve`, json('POST', { status })),
  settings: (f: AuthenticatedFetch) => request<AdminSettings>(f, '/admin/settings'),
  updateSettings: (f: AuthenticatedFetch, body: Partial<AdminSettings>) => request<AdminSettings>(f, '/admin/settings', json('PUT', body)),
};
