import { api } from "./auth";

export type StaffEvent = {
  id: number;
  slug: string;
  title: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  role: "organizer" | "event_admin";
};

export type Attendance = { registered: number; checked_in: number; absent: number; checked_in_percent: number };
export type ScannedTicket = { public_code: string; status: string; attendee_name: string; ticket_type_name: string };
export type ScanOutcome = "valid" | "invalid" | "wrong_event" | "cancelled" | "refunded" | "already_used";
export type ScanResponse = { outcome: ScanOutcome; ticket: ScannedTicket | null };

const base = (eventId: number) => `/staff/events/${eventId}`;
const deviceBody = (deviceInfo?: string) => ({ device_info: deviceInfo?.slice(0, 200) || null });

export const checkInApi = {
  events: (signal?: AbortSignal) => api.get<StaffEvent[]>("/staff/events", { signal }),
  attendance: (eventId: number, signal?: AbortSignal) => api.get<Attendance>(`${base(eventId)}/attendance`, { signal }),
  search: (eventId: number, query: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: query.trim() });
    return api.get<ScannedTicket[]>(`${base(eventId)}/search?${params}`, { signal });
  },
  scan: (eventId: number, qr: string, deviceInfo?: string) =>
    api.post<ScanResponse>(`${base(eventId)}/scan`, { qr, ...deviceBody(deviceInfo) }),
  admit: (eventId: number, publicCode: string, deviceInfo?: string) =>
    api.post<ScanResponse>(`${base(eventId)}/tickets/${encodeURIComponent(publicCode)}/check-in`, deviceBody(deviceInfo)),
  reverse: (eventId: number, publicCode: string, deviceInfo?: string) =>
    api.post<ScannedTicket>(`${base(eventId)}/tickets/${encodeURIComponent(publicCode)}/reverse`, deviceBody(deviceInfo)),
};
