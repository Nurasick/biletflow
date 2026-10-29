import { API_BASE_URL, API_V1_URL } from '@/constants/api';

export type EventCategory = 'concert' | 'conference' | 'sport' | 'theater' | 'other';

export type PublicEvent = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: EventCategory | null;
  cover_image_url: string | null;
  status: string;
  visibility: string;
  seating_mode: string;
  venue_name: string;
  venue_address: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number | null;
  refund_policy: string | null;
  phase: string;
};

export type EventDetail = PublicEvent & {
  organizer_name: string;
  images: { id: number; url: string; position: number }[];
  paid_sales_active: boolean;
};

export type PublicTicketType = {
  id: number;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  sales_start_at: string | null;
  sales_end_at: string | null;
  max_per_order: number | null;
  available: number;
};

export type EventFilters = {
  q?: string;
  category?: EventCategory;
  limit?: number;
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_V1_URL}${path}`, { signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the BiletFlow API. Check your connection and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail?: unknown }).detail
      : null;
    throw new Error(typeof detail === 'string' ? detail : 'Could not load events. Please try again.');
  }
  return body as T;
}

function queryString(filters: EventFilters) {
  const params = new URLSearchParams();
  params.set('limit', String(filters.limit ?? 50));
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.category) params.set('category', filters.category);
  return `?${params.toString()}`;
}

export const eventsApi = {
  list: (filters: EventFilters = {}, signal?: AbortSignal) =>
    getJson<PublicEvent[]>(`/events${queryString(filters)}`, signal),
  get: (slug: string, signal?: AbortSignal) =>
    getJson<EventDetail>(`/events/${encodeURIComponent(slug)}`, signal),
  ticketTypes: (slug: string, signal?: AbortSignal) =>
    getJson<PublicTicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types`, signal),
};

/** Local backend media URLs often say localhost; on a phone that means the phone itself. */
export function resolveEventImage(url: string | null | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, API_BASE_URL);
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
      const api = new URL(API_BASE_URL);
      parsed.protocol = api.protocol;
      parsed.hostname = api.hostname;
      parsed.port = api.port;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function formatEventPrice(priceMinor: number) {
  if (priceMinor === 0) return 'Free';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(priceMinor / 100)} ₸`;
}
