import { api, optionalAuthFile, optionalAuthRequest, rawRequest } from "./auth";
import { eventAccessHeaders } from "./eventAccess";
import type { EventPhase, OrganizerEventRecord } from "./organizerEvents";

export type PublicEvent = OrganizerEventRecord & { phase: EventPhase; seating_mode?: "general_admission" | "assigned" };
export type CalendarLinks = { ics: string; google: string; outlook: string; yahoo: string };

export type EventDetail = PublicEvent & {
  organizer_name: string;
  images: { id: number; url: string; position: number }[];
  paid_sales_active: boolean;
  processing_fee_bps?: number;
  calendar_links?: CalendarLinks | null;
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
  event_seat_id?: number | null;
  section_name?: string | null;
  row_label?: string | null;
  seat_number?: string | null;
  seat_label?: string | null;
  // Signed by the server; drawn as a QR, never built on the client.
  qr_payload: string;
};

export type Order = {
  order_number: string;
  event_id: number;
  event: Pick<PublicEvent, "slug" | "title" | "venue_name" | "venue_address" | "starts_at" | "ends_at" | "timezone" | "status">
    & { calendar_links?: CalendarLinks | null };
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
  promo_code: string | null;
  items: { id: number; ticket_type_id: number; quantity: number; unit_price_minor: number; discount_minor: number; subtotal_minor: number }[];
  tickets: OrderTicket[];
};

export type CheckoutInput = {
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  items: { ticket_type_id: number; attendees: { full_name: string; event_seat_id?: number }[] }[];
  promo_code?: string;
  campaign_token?: string;
};

export type EventFilters = {
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
  city?: string;
  price_type?: "free" | "paid";
  sort?: "soonest" | "newest" | "title";
  starts_after?: string;
  starts_before?: string;
};

export type EventSeat = {
  event_seat_id: number;
  section_name: string;
  row_label: string;
  seat_number: string;
  status: "available" | "held" | "sold" | "unavailable";
  is_accessible: boolean;
  ticket_type_id: number | null;
  price_minor: number | null;
  currency: string | null;
  seat_label: string;
};

export type EventSeatMap = {
  sections: { section_id: number; name: string; rows: { row_id: number; name: string; seats: EventSeat[] }[] }[];
};

export const eventReportReasons = ["fraud", "misleading", "illegal", "duplicate", "other"] as const;
export type EventReportReason = (typeof eventReportReasons)[number];

const query = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

// `token` is the signed guest link; signed-in owners need none.
const orderPath = (orderNumber: string, token?: string | null, action = "") =>
  `/orders/${encodeURIComponent(orderNumber)}${action ? `/${action}` : ""}${token ? query({ token }) : ""}`;

export const eventsApi = {
  list: (filters: EventFilters = {}, signal?: AbortSignal) =>
    rawRequest<PublicEvent[]>(`/events${query({ limit: 20, ...filters })}`, { signal }),
  get: (slug: string, accessToken?: string | null, signal?: AbortSignal) =>
    optionalAuthRequest<EventDetail>(`/events/${encodeURIComponent(slug)}`, { headers: eventAccessHeaders(accessToken), signal }),
  ticketTypes: (slug: string, accessToken?: string | null, signal?: AbortSignal) =>
    optionalAuthRequest<PublicTicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types`, { headers: eventAccessHeaders(accessToken), signal }),
  seats: (slug: string, accessToken?: string | null, signal?: AbortSignal) =>
    optionalAuthRequest<EventSeatMap>(`/events/${encodeURIComponent(slug)}/seats`, {
      headers: eventAccessHeaders(accessToken), signal,
    }),
  calendar: (slug: string, accessToken?: string | null) => optionalAuthFile(
    `/events/${encodeURIComponent(slug)}/calendar.ics`, "text/calendar", { headers: eventAccessHeaders(accessToken) },
  ),
  report: (slug: string, reason: EventReportReason, details: string) =>
    optionalAuthRequest<{ detail: string }>(`/events/${encodeURIComponent(slug)}/report`,
      api.json("POST", { reason, details: details.trim() || null })),
};

export const ordersApi = {
  /** Guests may buy: the response's access_token is their only way back. */
  checkout: (slug: string, input: CheckoutInput, accessToken?: string | null) => optionalAuthRequest<Order & { access_token: string }>(
    `/events/${encodeURIComponent(slug)}/orders`, {
      ...api.json("POST", input), headers: { "Content-Type": "application/json", ...eventAccessHeaders(accessToken) },
    }),
  get: (orderNumber: string, token?: string | null) => optionalAuthRequest<Order>(orderPath(orderNumber, token)),
  /** Simulated payment (§4.6). The key makes a double click charge once. */
  pay: (orderNumber: string, token: string | null, idempotencyKey: string, outcome: "succeed" | "fail" = "succeed") =>
    optionalAuthRequest<Order>(orderPath(orderNumber, token, "pay"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ outcome }),
    }),
  cancel: (orderNumber: string, token: string | null) => optionalAuthRequest<Order>(
    orderPath(orderNumber, token, "cancel"), { method: "POST" }),
  mine: () => api.get<Order[]>("/users/me/orders"),
  calendar: (orderNumber: string, token: string | null) =>
    optionalAuthFile(orderPath(orderNumber, token, "calendar.ics"), "text/calendar"),
  ticketsPdf: (orderNumber: string, token: string | null, publicCode?: string) =>
    optionalAuthFile(
      orderPath(orderNumber, token, publicCode ? `tickets/${encodeURIComponent(publicCode)}.pdf` : "tickets.pdf"),
      "application/pdf",
    ),
};
