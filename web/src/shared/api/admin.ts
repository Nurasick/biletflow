import { ApiError, api } from "./auth";
import type { EventReportReason, Order } from "./events";
import type { OrganizerEventRecord } from "./organizerEvents";

export type AdminEvent = OrganizerEventRecord & {
  organizer_profile_id: number;
  seating_mode: "general_admission" | "assigned";
  created_at: string;
};
export type AdminEventAction = "suspend" | "unsuspend" | "cancel";
export type AdminActivationAction = "suspend" | "reinstate";
export type AdminActivation = {
  status: "pending" | "active" | "suspended";
  activation_fee_minor: number;
  currency: string;
  is_simulated: boolean;
  terms_accepted_at: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  checklist: {
    paid_ticket_type: boolean;
    organizer_verified: boolean;
    fee_paid: boolean;
    payout_account_active: boolean;
    terms_accepted: boolean;
  };
};
export type AdminTimelineEntry = {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number;
  summary: string;
  payload: Record<string, unknown> | null;
};
export type AdminUser = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  status: "active" | "suspended";
  is_email_verified: boolean;
  is_platform_admin: boolean;
  created_at: string;
};
export type AdminOverview = {
  users: number;
  organizers: number;
  events_published: number;
  events_suspended: number;
  orders_confirmed: number;
  tickets_issued: number;
  gross_minor: number;
  refunds_minor: number;
  payments_failed: number;
  open_reports: number;
  open_support_cases: number;
  is_simulated: boolean;
};

export const eventReportStatuses = ["open", "dismissed", "actioned"] as const;
export type EventReportStatus = (typeof eventReportStatuses)[number];
export type EventReportResolution = Exclude<EventReportStatus, "open">;
export type AdminEventReport = {
  id: number;
  event_id: number;
  event_title: string;
  event_slug: string;
  event_status: AdminEvent["status"];
  reason: EventReportReason;
  details: string | null;
  status: EventReportStatus;
  created_at: string;
  resolved_at: string | null;
};

export const adminOrderStatuses = ["pending", "confirmed", "cancelled", "refunded", "expired"] as const;
export const adminPaymentStatuses = ["pending", "succeeded", "failed", "refunded"] as const;
export type AdminOrderStatus = (typeof adminOrderStatuses)[number];
export type AdminPaymentStatus = (typeof adminPaymentStatuses)[number];

export type AdminOrder = {
  order_number: string;
  event_id: number;
  event_title: string;
  status: Order["status"];
  contact_name: string;
  contact_email: string;
  total_minor: number;
  discount_minor: number;
  currency: string;
  created_at: string;
};

export type AdminPayment = {
  id: number;
  purpose: "ticket_order" | "activation_fee";
  status: AdminPaymentStatus;
  amount_minor: number;
  currency: string;
  provider: string;
  provider_ref: string | null;
  is_simulated: boolean;
  failure_reason: string | null;
  order_number: string | null;
  event_id: number | null;
  created_at: string;
};

export type AdminRefund = {
  id: number;
  order_number: string;
  event_id: number;
  amount_minor: number;
  currency: string;
  status: Exclude<AdminPaymentStatus, "refunded">;
  reason: string;
  created_at: string;
};

export type AdminActivationRecord = Pick<AdminActivation, "status" | "activation_fee_minor" | "activated_at" | "suspension_reason"> & {
  event_id: number;
  event_title: string;
  fee_paid: boolean;
};

export type AdminCampaign = {
  id: number;
  event_id: number;
  event_title: string;
  name: string;
  code: string;
  is_active: boolean;
  redemptions: number;
  orders: number;
  discount_minor: number;
  net_minor: number;
};

export type AdminSettings = {
  activation_fee_minor: number;
  processing_fee_bps: number;
};

export type AdminPageRequest = { limit: number; offset: number; signal?: AbortSignal };

const base = (eventId: number) => `/admin/events/${eventId}`;
const params = (limit: number, offset: number, query?: string, status?: string) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query?.trim()) search.set("q", query.trim());
  if (status) search.set("status", status);
  return search;
};

export const adminApi = {
  overview: (signal?: AbortSignal) => api.get<AdminOverview>("/admin/overview", { signal }),
  users: (query: string, limit: number, offset: number, signal?: AbortSignal) =>
    api.get<AdminUser[]>(`/admin/users?${params(limit, offset, query)}`, { signal }),
  suspendUser: (userId: number, reason: string) =>
    api.post<AdminUser>(`/admin/users/${userId}/suspend`, { reason: reason.trim() }),
  reinstateUser: (userId: number) => api.post<AdminUser>(`/admin/users/${userId}/unsuspend`),
  reports: (status: EventReportStatus | undefined, limit: number, offset: number, signal?: AbortSignal) =>
    api.get<AdminEventReport[]>(`/admin/reports?${params(limit, offset, undefined, status)}`, { signal }),
  resolveReport: (reportId: number, status: EventReportResolution) =>
    api.post<AdminEventReport>(`/admin/reports/${reportId}/resolve`, { status }),
  orders: ({ limit, offset, signal }: AdminPageRequest, query: string, status?: AdminOrderStatus) =>
    api.get<AdminOrder[]>(`/admin/orders?${params(limit, offset, query, status)}`, { signal }),
  payments: ({ limit, offset, signal }: AdminPageRequest, status?: AdminPaymentStatus) =>
    api.get<AdminPayment[]>(`/admin/payments?${params(limit, offset, undefined, status)}`, { signal }),
  refunds: ({ limit, offset, signal }: AdminPageRequest) =>
    api.get<AdminRefund[]>(`/admin/refunds?${params(limit, offset)}`, { signal }),
  activations: ({ limit, offset, signal }: AdminPageRequest) =>
    api.get<AdminActivationRecord[]>(`/admin/activations?${params(limit, offset)}`, { signal }),
  campaigns: ({ limit, offset, signal }: AdminPageRequest) =>
    api.get<AdminCampaign[]>(`/admin/campaigns?${params(limit, offset)}`, { signal }),
  settings: (signal?: AbortSignal) => api.get<AdminSettings>("/admin/settings", { signal }),
  updateSettings: (changes: Partial<AdminSettings>) => api.put<AdminSettings>("/admin/settings", changes),
  ordersCsv: () => api.file("/admin/exports/orders.csv", "text/csv"),
  paymentsCsv: () => api.file("/admin/exports/payments.csv", "text/csv"),
  events: (query = "", limit = 20, offset = 0, signal?: AbortSignal) =>
    api.get<AdminEvent[]>(`/admin/events?${params(limit, offset, query)}`, { signal }),
  // The current backend exposes event reads only through its paginated admin
  // list. A slug hint keeps list-to-detail navigation efficient; bare ID links
  // still work by walking that authorized list, including non-public events.
  event: async (eventId: number, slugHint?: string, signal?: AbortSignal): Promise<AdminEvent> => {
    for (const query of slugHint ? [slugHint, ""] : [""]) {
      for (let offset = 0; ; offset += 100) {
        const page = await adminApi.events(query, 100, offset, signal);
        const found = page.find((event) => event.id === eventId);
        if (found) return found;
        if (page.length < 100) break;
      }
    }
    throw new ApiError("Event not found", 404);
  },
  transition: (eventId: number, action: AdminEventAction, reason?: string) =>
    api.post<AdminEvent>(`${base(eventId)}/${action}`, action === "unsuspend" ? undefined : { reason: reason?.trim() || null }),
  activation: async (eventId: number, signal?: AbortSignal): Promise<AdminActivation | null> => {
    try {
      return await api.get<AdminActivation>(`${base(eventId)}/activation`, { signal });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.message === "This event has no activation record") return null;
      throw error;
    }
  },
  transitionActivation: (eventId: number, action: AdminActivationAction, reason?: string) =>
    api.post<AdminActivation>(`${base(eventId)}/activation/${action}`, action === "suspend" ? { reason: reason?.trim() } : undefined),
  timeline: (eventId: number, limit = 25, offset = 0, signal?: AbortSignal) =>
    api.get<AdminTimelineEntry[]>(`${base(eventId)}/timeline?${params(limit, offset)}`, { signal }),
};
