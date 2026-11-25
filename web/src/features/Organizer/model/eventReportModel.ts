import type { PageOptions, TimelineFilters } from "../../../shared/api/eventReports";
import { readEventLocalTime } from "./eventDateTime";

export const REPORT_PAGE_SIZE = 25;
export const reportPage = (page: number) => ({ limit: REPORT_PAGE_SIZE + 1, offset: page * REPORT_PAGE_SIZE });

export const eventReportKeys = {
  summary: (userId: number, eventId: number) => ["organizer", "summary", userId, eventId] as const,
  orders: (userId: number, eventId: number) => ["organizer", "orders", userId, eventId] as const,
  attendees: (userId: number, eventId: number, page: number) => ["organizer", "attendees", userId, eventId, page] as const,
  // Every row at once, for client-side search (the API has no search parameter).
  allAttendees: (userId: number, eventId: number) => ["organizer", "attendees", userId, eventId, "all"] as const,
  allOrders: (userId: number, eventId: number) => ["organizer", "orders", userId, eventId, "all"] as const,
  timeline: (userId: number, eventId: number, filters: TimelineFilters, page: number) =>
    ["organizer", "timeline", userId, eventId, filters, page] as const,
};

export const REPORT_BATCH_SIZE = 200;
export const REPORT_MAX_ROWS = 5_000;

/** Read every page (the API caps a page at 200 rows), stopping at REPORT_MAX_ROWS. */
export const fetchAllRows = async <T>(fetchPage: (options: PageOptions) => Promise<T[]>, signal?: AbortSignal) => {
  const rows: T[] = [];
  while (rows.length < REPORT_MAX_ROWS) {
    const page = await fetchPage({ limit: REPORT_BATCH_SIZE, offset: rows.length, signal });
    rows.push(...page);
    if (page.length < REPORT_BATCH_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
};

/** Case-insensitive substring search over a row's text fields. */
export const matchesSearch = (query: string, fields: readonly (string | null | undefined)[]) => {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || fields.some((field) => field?.toLocaleLowerCase().includes(needle));
};

/** One page of already-filtered rows. */
export const clientPage = <T>(rows: readonly T[], page: number) => ({
  rows: rows.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE),
  hasNext: rows.length > (page + 1) * REPORT_PAGE_SIZE,
});

// The audit vocabulary emitted by the backend services; the API accepts several actions.
export const EVENT_AUDIT_ACTIONS = [
  "event.updated", "event.capacity_changed", "event.published", "event.unpublished", "event.cancelled",
  "event.suspended", "event.unsuspended", "event.duplicated",
  "ticket_type.price_changed", "ticket_type.capacity_changed",
  "activation.terms_accepted", "activation.fee_paid", "activation.fee_failed", "activation.activated",
  "activation.suspended", "activation.reinstated", "order.confirmed", "order.cancelled", "order.refunded",
  "refund.initiated", "payment.succeeded", "payment.failed", "staff.assigned", "staff.removed",
  "ticket.checked_in", "ticket.check_in_reversed",
  "campaign.created", "campaign.updated", "campaign.enabled", "campaign.disabled",
  "support.status_changed",
] as const;

// datetime-local has no offset. The filters are read as wall-clock time in the
// event's zone (like every other organizer date), rejecting impossible dates
// and daylight-saving gaps or overlaps, then sent as UTC.
export const timelineFilters = (since: string, until: string, actions: string[], timeZone: string):
  { filters: TimelineFilters; error?: never } | { filters?: never; error: "invalidDate" | "invalidRange" } => {
  const start = readEventLocalTime(since, timeZone);
  const end = readEventLocalTime(until, timeZone);
  if (start.error || end.error) return { error: "invalidDate" };
  if (start.instant && end.instant && Date.parse(end.instant) <= Date.parse(start.instant)) return { error: "invalidRange" };
  return { filters: {
    since: start.instant ?? undefined, until: end.instant ?? undefined, actions: [...new Set(actions)].sort(),
  } };
};
