import { api } from "./auth";
import type { OrganizerTicketType } from "./eventLifecycle";

export type TicketTypeInput = {
  name: string;
  description: string | null;
  price_minor: number;
  quantity_total: number;
  max_per_order: number | null;
  is_hidden: boolean;
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

export type StaffMember = { user_id: number; email: string; first_name: string; last_name: string };

const base = (eventId: number) => `/organizer/events/${eventId}`;

export const ticketTypesApi = {
  list: (eventId: number) => api.get<OrganizerTicketType[]>(`${base(eventId)}/ticket-types`),
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
  summary: (eventId: number) => api.get<EventSummary>(`${base(eventId)}/summary`),
  orders: (eventId: number) => api.get<OrganizerOrder[]>(`${base(eventId)}/orders`),
  refund: (eventId: number, orderNumber: string, reason: string) =>
    api.post<OrganizerOrder>(`${base(eventId)}/orders/${orderNumber}/refund`, { reason }),
  cancel: (eventId: number, orderNumber: string) =>
    api.post<OrganizerOrder>(`${base(eventId)}/orders/${orderNumber}/cancel`),
};

export const staffApi = {
  list: (eventId: number) => api.get<StaffMember[]>(`${base(eventId)}/staff`),
  assign: (eventId: number, email: string) => api.post<StaffMember[]>(`${base(eventId)}/staff`, { email }),
  remove: (eventId: number, userId: number) => api.delete<null>(`${base(eventId)}/staff/${userId}`),
};
