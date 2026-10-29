import { api } from "./auth";

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
type PageOptions = { limit: number; offset: number; signal?: AbortSignal };

const pageParams = ({ limit, offset }: PageOptions) => new URLSearchParams({
  limit: String(limit), offset: String(offset),
});

export const eventReportsApi = {
  attendees: (eventId: number, options: PageOptions) => api.get<AttendeeRow[]>(
    `/organizer/events/${eventId}/attendees?${pageParams(options)}`, { signal: options.signal },
  ),
  timeline: (eventId: number, filters: TimelineFilters, options: PageOptions) => {
    const params = pageParams(options);
    if (filters.since) params.set("since", filters.since);
    if (filters.until) params.set("until", filters.until);
    for (const action of filters.actions) params.append("action", action);
    return api.get<TimelineEntry[]>(`/organizer/events/${eventId}/timeline?${params}`, { signal: options.signal });
  },
};
