export type OrderStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'expired';
export type TicketStatus = 'valid' | 'checked_in' | 'cancelled' | 'refunded';

export type OrderTicket = {
  public_code: string;
  ticket_type_id: number;
  ticket_type_name: string;
  status: TicketStatus;
  attendee_name: string;
  seat_label?: string | null;
  section_name?: string | null;
  row_label?: string | null;
  seat_number?: string | null;
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
    calendar_links?: { google: string; outlook: string } | null;
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
  items: { id: number; ticket_type_id: number; event_seat_id?:number|null; section_name?:string|null; row_label?:string|null; seat_number?:string|null; quantity: number; unit_price_minor: number; subtotal_minor: number }[];
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

  pay: (fetcher: AuthenticatedFetch, orderNumber: string, outcome: 'succeed'|'fail' = 'succeed') =>
    requestJson<Order>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `mobile-${orderNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      },
      body: JSON.stringify({ outcome }),
    }),

  cancel: (fetcher: AuthenticatedFetch, orderNumber: string) =>
    requestJson<Order>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/cancel`, { method: 'POST' }),

  /** Which checkout the server runs: the demo buttons, or Halyk ePay. */
  paymentProvider: (fetcher: AuthenticatedFetch, signal?: AbortSignal) =>
    requestJson<PaymentProvider>(fetcher, '/payments/provider', { signal }),

  /** Opens a Halyk invoice. Open `checkout_url` in a browser; Halyk sends the
   * buyer back to `returnUrl` (the app's deep link). Nothing is charged here. */
  startHalyk: (fetcher: AuthenticatedFetch, orderNumber: string, returnUrl: string) =>
    requestJson<{ checkout_url: string; invoice_id: string }>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/halyk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ return_url: returnUrl }),
    }),

  /** Asks the server to check with Halyk now; returns the settled (or still pending) order. */
  syncHalyk: (fetcher: AuthenticatedFetch, orderNumber: string) =>
    requestJson<Order>(fetcher, `/orders/${encodeURIComponent(orderNumber)}/halyk/sync`, { method: 'POST' }),
};

export type PaymentProvider = { provider: 'simulator' | 'halyk'; is_sandbox: boolean };

export function formatOrderMoney(minor: number, currency = 'KZT', locale?: string) {
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(minor / 100);
  return `${amount} ${currency === 'KZT' ? '₸' : currency}`;
}
