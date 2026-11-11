import { api } from "./auth";
import type { CampaignStats } from "./campaigns";
import type { Attendance } from "./staff";

export type AttendeeRow = {
  public_code: string;
  ticket_status: string;
  ticket_type_name: string;
  order_number: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

export type TimelineEntry = {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number;
  summary: string;
  payload: Record<string, unknown> | null;
};

export type TimelineFilters = { since?: string; until?: string; actions: string[] };
export type AnalyticsFilters = { since?: string; until?: string; ticketTypeId?: number };
export type EventAnalytics = {
  is_simulated: boolean;
  capacity: number;
  tickets_sold: number;
  tickets_remaining: number;
  percent_sold: number;
  gross_minor: number;
  discounts_minor: number;
  refunds_minor: number;
  net_minor: number;
  sales_over_time: { date: string; tickets: number; revenue_minor: number }[];
  by_ticket_type: {
    ticket_type_id: number;
    name: string;
    quantity_total: number;
    quantity_sold: number;
    quantity_reserved: number;
    tickets_in_range: number;
    revenue_minor: number;
  }[];
  campaigns: (CampaignStats & { id: number; name: string; code: string; is_active: boolean })[];
  attendance: Attendance;
};
type PageOptions = { limit: number; offset: number; signal?: AbortSignal };

const pageParams = ({ limit, offset }: PageOptions) => new URLSearchParams({
  limit: String(limit), offset: String(offset),
});

export const eventReportsApi = {
  attendees: (eventId: number, options: PageOptions) => api.get<AttendeeRow[]>(
    `/organizer/events/${eventId}/attendees?${pageParams(options)}`, { signal: options.signal },
  ),
  attendeesCsv: (eventId: number) => api.file(`/organizer/events/${eventId}/attendees.csv`, "text/csv"),
  analytics: (eventId: number, filters: AnalyticsFilters, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (filters.since) params.set("since", filters.since);
    if (filters.until) params.set("until", filters.until);
    if (filters.ticketTypeId !== undefined) params.set("ticket_type_id", String(filters.ticketTypeId));
    return api.get<EventAnalytics>(`/organizer/events/${eventId}/analytics${params.size ? `?${params}` : ""}`, { signal });
  },
  timeline: (eventId: number, filters: TimelineFilters, options: PageOptions) => {
    const params = pageParams(options);
    if (filters.since) params.set("since", filters.since);
    if (filters.until) params.set("until", filters.until);
    for (const action of filters.actions) params.append("action", action);
    return api.get<TimelineEntry[]>(`/organizer/events/${eventId}/timeline?${params}`, { signal: options.signal });
  },
};
