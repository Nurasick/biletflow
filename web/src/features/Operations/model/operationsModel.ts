import type { AdminActivationAction, AdminEventAction, EventReportStatus } from "../../../shared/api/admin";
import type { ScannedTicket } from "../../../shared/api/staff";

export const operationsKeys = {
  staffEvents: (userId?: number) => ["operations", userId, "staff-events"] as const,
  attendance: (userId: number | undefined, eventId: number) => ["operations", userId, "attendance", eventId] as const,
  ticketSearches: (userId: number | undefined, eventId: number) => ["operations", userId, "ticket-search", eventId] as const,
  ticketSearch: (userId: number | undefined, eventId: number, query: string) => ["operations", userId, "ticket-search", eventId, query] as const,
  adminLists: (userId?: number) => ["operations", userId, "admin-events"] as const,
  adminList: (userId: number | undefined, query: string, page: number, status?: string) =>
    ["operations", userId, "admin-events", query, page, status ?? null] as const,
  adminEvent: (userId: number | undefined, eventId: number) => ["operations", userId, "admin-event", eventId] as const,
  adminOverview: (userId?: number) => ["operations", userId, "admin-overview"] as const,
  adminUsers: (userId: number) => ["operations", userId, "admin-users"] as const,
  adminUserList: (userId: number, query: string, page: number) => ["operations", userId, "admin-users", query, page] as const,
  adminReports: (userId?: number) => ["operations", userId, "admin-reports"] as const,
  adminReportList: (userId: number, status: EventReportStatus | "all", page: number) =>
    ["operations", userId, "admin-reports", status, page] as const,
  adminRecords: (userId: number | undefined, kind: "orders" | "payments" | "refunds" | "activations" | "campaigns" | "disputes") =>
    ["operations", userId, "admin-records", kind] as const,
  adminSettings: (userId: number) => ["operations", userId, "admin-settings"] as const,
  activation: (userId: number | undefined, eventId: number) => ["operations", userId, "activation", eventId] as const,
  timelines: (userId: number | undefined, eventId: number) => ["operations", userId, "timeline", eventId] as const,
  timeline: (userId: number | undefined, eventId: number, page: number, range: { since?: string; until?: string } = {}) =>
    ["operations", userId, "timeline", eventId, page, range.since ?? null, range.until ?? null] as const,
};

export const ticketAction = (ticket: ScannedTicket): "admit" | "reverse" | null => {
  if (ticket.status === "valid") return "admit";
  if (ticket.status === "checked_in") return "reverse";
  return null;
};

export const eventModerationActions = (status: string): AdminEventAction[] => {
  if (status === "published") return ["suspend", "cancel"];
  if (status === "suspended") return ["unsuspend", "cancel"];
  if (status === "draft") return ["cancel"];
  return [];
};

export const activationModerationAction = (status: string): AdminActivationAction | null => {
  if (status === "active") return "suspend";
  if (status === "suspended") return "reinstate";
  return null;
};

export const validEventId = (value?: string) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const zoneOffsetMs = (instant: number, timeZone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
};

/** A `datetime-local` value read as wall-clock time in `timeZone`, as an ISO instant.
 * Returns null for malformed input or a time skipped by a daylight-saving jump. */
export const zonedWallClockToIso = (value: string, timeZone: string): string | null => {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(asUtc);
  // Date.UTC rolls 2026-13-01 over to January; reject anything that did not round-trip.
  if (Number.isNaN(asUtc) || hour > 23 || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  try {
    let instant = asUtc - zoneOffsetMs(asUtc, timeZone);
    instant = asUtc - zoneOffsetMs(instant, timeZone);
    const back = asUtc - zoneOffsetMs(instant, timeZone);
    return back === instant ? new Date(instant).toISOString() : null;
  } catch {
    return null;
  }
};

export type AdminTimelineRange = { since?: string; until?: string };

/** Validated admin timeline window, entered in the event's own time zone. */
export const adminTimelineRange = (since: string, until: string, timeZone: string):
  { range: AdminTimelineRange; error?: never } | { range?: never; error: "invalidDate" | "invalidRange" } => {
  const start = since ? zonedWallClockToIso(since, timeZone) : undefined;
  const end = until ? zonedWallClockToIso(until, timeZone) : undefined;
  if (start === null || end === null) return { error: "invalidDate" };
  if (start && end && end <= start) return { error: "invalidRange" };
  return { range: { ...(start && { since: start }), ...(end && { until: end }) } };
};
