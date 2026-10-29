export type OrderStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'expired';
export type TicketStatus = 'valid' | 'checked_in' | 'cancelled' | 'refunded';

export type OrderTicket = {
  public_code: string;
  ticket_type_id: number;
  ticket_type_name: string;
  status: TicketStatus;
  attendee_name: string;
  qr_payload: string;
};

export type Order = {
  order_number: string;
  event_id: number;
  event: {
    slug: string;
    title: string;
    venue_name: string;
    venue_address: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    status: string;
  };
  status: OrderStatus;
  contact_name: string;
  contact_email: string;
  subtotal_minor: number;
  discount_minor: number;
  fee_minor: number;
  total_minor: number;
  currency: string;
  expires_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  items: { id: number; ticket_type_id: number; quantity: number; unit_price_minor: number; subtotal_minor: number }[];
  tickets: OrderTicket[];
};

export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

async function requestJson<T>(fetcher: AuthenticatedFetch, path: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(path, init);
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail?: unknown }).detail
      : null;
    throw new Error(typeof detail === 'string' ? detail : 'The request could not be completed. Please try again.');
  }
  return body as T;
}

export const ordersApi = {
  mine: (fetcher: AuthenticatedFetch, signal?: AbortSignal) =>
    requestJson<Order[]>(fetcher, '/users/me/orders', { signal }),

  pay: (fetcher: AuthenticatedFetch, orderNumber: string) =>
    requestJson<Order>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `mobile-${orderNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      },
      body: JSON.stringify({ outcome: 'succeed' }),
    }),

  cancel: (fetcher: AuthenticatedFetch, orderNumber: string) =>
    requestJson<Order>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/cancel`, { method: 'POST' }),
};

export function formatOrderMoney(minor: number, currency = 'KZT') {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(minor / 100);
  return `${amount} ${currency === 'KZT' ? '₸' : currency}`;
}
