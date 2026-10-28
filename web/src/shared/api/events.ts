import { api, optionalAuthRequest, rawRequest } from "./auth";
import type { EventPhase, OrganizerEventRecord } from "./organizerEvents";

export type PublicEvent = OrganizerEventRecord & { phase: EventPhase };

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

export type OrderTicket = {
  public_code: string;
  ticket_type_id: number;
  ticket_type_name: string;
  status: "valid" | "checked_in" | "cancelled" | "refunded";
  attendee_name: string;
  // Signed by the server; drawn as a QR, never built on the client.
  qr_payload: string;
};

export type Order = {
  order_number: string;
  event_id: number;
  event: Pick<PublicEvent, "slug" | "title" | "venue_name" | "venue_address" | "starts_at" | "ends_at" | "timezone" | "status">;
  status: "pending" | "confirmed" | "cancelled" | "refunded" | "partially_refunded" | "expired";
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

export type CheckoutInput = {
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  items: { ticket_type_id: number; attendees: { full_name: string }[] }[];
};

export type EventFilters = { q?: string; category?: string; limit?: number };

const query = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

// `token` is the signed guest link; signed-in owners need none.
const orderPath = (orderNumber: string, token?: string | null, action = "") =>
  `/orders/${encodeURIComponent(orderNumber)}${action ? `/${action}` : ""}${token ? query({ token }) : ""}`;

export const eventsApi = {
  list: (filters: EventFilters = {}) =>
    rawRequest<PublicEvent[]>(`/events${query({ limit: 20, ...filters })}`),
  get: (slug: string) => rawRequest<EventDetail>(`/events/${encodeURIComponent(slug)}`),
  ticketTypes: (slug: string) =>
    rawRequest<PublicTicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types`),
};

export const ordersApi = {
  /** Guests may buy: the response's access_token is their only way back. */
  checkout: (slug: string, input: CheckoutInput) => optionalAuthRequest<Order & { access_token: string }>(
    `/events/${encodeURIComponent(slug)}/orders`, api.json("POST", input)),
  get: (orderNumber: string, token?: string | null) => optionalAuthRequest<Order>(orderPath(orderNumber, token)),
  /** Simulated payment (§4.6). The key makes a double click charge once. */
  pay: (orderNumber: string, token: string | null, idempotencyKey: string) =>
    optionalAuthRequest<Order>(orderPath(orderNumber, token, "pay"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ outcome: "succeed" }),
    }),
  cancel: (orderNumber: string, token: string | null) => optionalAuthRequest<Order>(
    orderPath(orderNumber, token, "cancel"), { method: "POST" }),
  mine: () => api.get<Order[]>("/users/me/orders"),
};
