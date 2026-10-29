import { ApiError, api } from "./auth";
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

const base = (eventId: number) => `/admin/events/${eventId}`;
const params = (limit: number, offset: number, query?: string) => {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query?.trim()) search.set("q", query.trim());
  return search;
};

export const adminApi = {
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
