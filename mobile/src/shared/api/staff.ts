import type { AuthenticatedFetch } from '@/shared/api/orders';

export type StaffEvent = {
  id: number;
  slug: string;
  title: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  role: 'organizer' | 'event_admin';
};

export type StaffTicket = {
  public_code: string;
  status: string;
  attendee_name: string;
  ticket_type_name: string;
};

export type ScanOutcome = 'valid' | 'invalid' | 'wrong_event' | 'cancelled' | 'refunded' | 'already_used';
export type ScanResult = { outcome: ScanOutcome; ticket: StaffTicket | null };
export type Attendance = { registered: number; checked_in: number; absent: number; checked_in_percent: number };

export class StaffApiError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = 'StaffApiError';
  }
}

function eventPath(eventId: number) {
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new StaffApiError('Choose an assigned event first.');
  return `/staff/events/${eventId}`;
}

async function request<T>(fetcher: AuthenticatedFetch, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new StaffApiError(init?.method === 'POST'
      ? 'Result unknown. Refresh attendance and search before trying again.'
      : 'Request failed. Check your connection.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (init?.method === 'POST' && response.status >= 500) {
      throw new StaffApiError('Result unknown. Refresh attendance and search before trying again.', response.status);
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new StaffApiError('Your access to this event is unavailable.', response.status);
    }
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail: unknown }).detail : null;
    throw new StaffApiError(typeof detail === 'string' ? detail : 'Request failed. Check your connection.', response.status);
  }
  if (body === null) throw new StaffApiError(init?.method === 'POST'
    ? 'Result unknown. Refresh attendance and search before trying again.'
    : 'Request failed. Check your connection.');
  return body as T;
}

const outcomes: readonly ScanOutcome[] = ['valid', 'invalid', 'wrong_event', 'cancelled', 'refunded', 'already_used'];
function verifiedResult(value: ScanResult): ScanResult {
  if (!value || !outcomes.includes(value.outcome)
    || (value.outcome === 'valid' && (!value.ticket || value.ticket.status !== 'checked_in'))) {
    throw new StaffApiError('Result unknown. Refresh attendance and search before trying again.');
  }
  return value;
}

function mutation(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}

export const staffApi = {
  events: (fetcher: AuthenticatedFetch, signal?: AbortSignal) =>
    request<StaffEvent[]>(fetcher, '/staff/events', { signal }),
  attendance: (fetcher: AuthenticatedFetch, eventId: number, signal?: AbortSignal) =>
    request<Attendance>(fetcher, `${eventPath(eventId)}/attendance`, { signal }),
  search: (fetcher: AuthenticatedFetch, eventId: number, query: string, signal?: AbortSignal) => {
    const term = query.trim();
    if (term.length < 2 || term.length > 100) throw new StaffApiError('Enter between 2 and 100 characters.');
    return request<StaffTicket[]>(fetcher, `${eventPath(eventId)}/search?q=${encodeURIComponent(term)}`, { signal });
  },
  scan: async (fetcher: AuthenticatedFetch, eventId: number, qr: string, deviceInfo: string, signal?: AbortSignal) => {
    // Campaign links and malformed payloads are never admitted locally. The server verifies the signed QR type.
    if (!qr.trim() || qr.length > 512) throw new StaffApiError('Invalid ticket');
    const result = await request<ScanResult>(fetcher, `${eventPath(eventId)}/scan`, mutation({ qr, device_info: deviceInfo.slice(0, 200) }, signal));
    return verifiedResult(result);
  },
  checkIn: async (fetcher: AuthenticatedFetch, eventId: number, publicCode: string, deviceInfo: string, signal?: AbortSignal) => {
    const result = await request<ScanResult>(fetcher, `${eventPath(eventId)}/tickets/${encodeURIComponent(publicCode)}/check-in`, mutation({ device_info: deviceInfo.slice(0, 200) }, signal));
    return verifiedResult(result);
  },
  reverse: async (fetcher: AuthenticatedFetch, eventId: number, publicCode: string, deviceInfo: string, signal?: AbortSignal) => {
    const ticket = await request<StaffTicket>(fetcher, `${eventPath(eventId)}/tickets/${encodeURIComponent(publicCode)}/reverse`, mutation({ device_info: deviceInfo.slice(0, 200) }, signal));
    if (!ticket || ticket.status !== 'valid') throw new StaffApiError('Result unknown. Refresh attendance and search before trying again.');
    return ticket;
  },
};
