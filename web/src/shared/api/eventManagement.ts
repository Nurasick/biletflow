import { api } from "./auth";
import type { OrganizerTicketType } from "./eventLifecycle";
import { pageParams } from "./eventReports";
import type { PageOptions } from "./eventReports";

export type TicketTypeInput = {
  name: string;
  description: string | null;
  price_minor: number;
  quantity_total: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  max_per_order: number | null;
  is_hidden: boolean;
  position: number;
};

export type Checklist = {
  paid_ticket_type: boolean;
  organizer_verified: boolean;
  fee_paid: boolean;
  payout_account_active: boolean;
  terms_accepted: boolean;
};

export type Activation = {
  status: "pending" | "active" | "suspended";
  activation_fee_minor: number;
  currency: string;
  is_simulated: boolean;
  terms_accepted_at: string | null;
  activated_at: string | null;
  suspension_reason: string | null;
  checklist: Checklist;
};

export type EventSummary = {
  currency: string;
  is_simulated: boolean;
  capacity: number;
  tickets_sold: number;
  tickets_reserved: number;
  tickets_remaining: number;
  percent_sold: number;
  gross_minor: number;
  refunds_minor: number;
  fees_minor: number;
  net_minor: number;
  estimated_payout_minor: number;
  tickets_refunded: number;
  attendance: { registered: number; checked_in: number; absent: number; checked_in_percent: number };
};

export type OrganizerOrder = {
  order_number: string;
  status: "confirmed" | "cancelled" | "refunded" | "partially_refunded";
  contact_name: string;
  contact_email: string;
  total_minor: number;
  currency: string;
  ticket_count: number;
  created_at: string;
};

export type VenueSummary = {
  id: number;
  slug: string;
  name: string;
  city: string;
  address: string;
  total_seats: number;
  accessible_seats: number;
  price_categories: string[];
  sections: { id: number; name: string; display_order: number; seat_count: number; price_categories: string[] }[];
};

export type SeatMap = {
  event_id: number;
  seating_mode: string;
  venue_id: number | null;
  venue_name: string;
  venue_city: string | null;
  venue_address: string;
  counts: { total: number; sellable: number; available: number; held: number; sold: number; unavailable: number };
  sections: { section_id: number; name: string; rows: { row_id: number; seats: { price_category: string; ticket_type_id: number | null }[] }[] }[];
};

/** price category -> ticket type, as the configured seat map currently has it. */
export const seatCategoryMap = (map: SeatMap): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const section of map.sections) for (const row of section.rows) for (const seat of row.seats) {
    if (seat.ticket_type_id !== null && result[seat.price_category] === undefined) result[seat.price_category] = seat.ticket_type_id;
  }
  return result;
};

export type SeatingConfig = { venue_id: number; category_ticket_type_map: Record<string, number> };

export type StaffMember = { user_id: number; email: string; first_name: string; last_name: string };

const base = (eventId: number) => `/organizer/events/${eventId}`;

export const ticketTypesApi = {
  list: (eventId: number, signal?: AbortSignal) => api.get<OrganizerTicketType[]>(`${base(eventId)}/ticket-types`, { signal }),
  create: (eventId: number, input: TicketTypeInput) =>
    api.post<OrganizerTicketType>(`${base(eventId)}/ticket-types`, input),
  update: (eventId: number, id: number, input: Partial<TicketTypeInput>) =>
    api.patch<OrganizerTicketType>(`${base(eventId)}/ticket-types/${id}`, input),
};

export const activationApi = {
  get: (eventId: number) => api.get<Activation>(`${base(eventId)}/activation`),
  acceptTerms: (eventId: number) => api.post<Activation>(`${base(eventId)}/activation/terms`),
  payFee: (eventId: number, outcome: "succeed" | "fail") =>
    api.post<Activation>(`${base(eventId)}/activation/fee`, { outcome }),
  activate: (eventId: number) => api.post<Activation>(`${base(eventId)}/activation/activate`),
};

export const salesApi = {
  summary: (eventId: number, signal?: AbortSignal) => api.get<EventSummary>(`${base(eventId)}/summary`, { signal }),
  orders: (eventId: number, options: PageOptions) =>
    api.get<OrganizerOrder[]>(`${base(eventId)}/orders?${pageParams(options)}`, { signal: options.signal }),
  refund: (eventId: number, orderNumber: string, reason: string) =>
    api.post<OrganizerOrder>(`${base(eventId)}/orders/${orderNumber}/refund`, { reason }),
  cancel: (eventId: number, orderNumber: string) =>
    api.post<OrganizerOrder>(`${base(eventId)}/orders/${orderNumber}/cancel`),
};

export const seatingApi = {
  venues: (signal?: AbortSignal) => api.get<VenueSummary[]>("/venues", { signal }),
  seats: (eventId: number, signal?: AbortSignal) => api.get<SeatMap>(`${base(eventId)}/seats`, { signal }),
  configure: (eventId: number, config: SeatingConfig) => api.put<SeatMap>(`${base(eventId)}/seating`, config),
};

export const staffApi = {
  list: (eventId: number) => api.get<StaffMember[]>(`${base(eventId)}/staff`),
  assign: (eventId: number, email: string) => api.post<StaffMember[]>(`${base(eventId)}/staff`, { email }),
  remove: (eventId: number, userId: number) => api.delete<null>(`${base(eventId)}/staff/${userId}`),
};
