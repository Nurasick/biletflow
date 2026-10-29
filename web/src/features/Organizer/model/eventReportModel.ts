import type { TimelineFilters } from "../../../shared/api/eventReports";

export const REPORT_PAGE_SIZE = 25;
export const reportPage = (page: number) => ({ limit: REPORT_PAGE_SIZE + 1, offset: page * REPORT_PAGE_SIZE });

export const eventReportKeys = {
  attendees: (userId: number, eventId: number, page: number) => ["organizer", "attendees", userId, eventId, page] as const,
  timeline: (userId: number, eventId: number, filters: TimelineFilters, page: number) =>
    ["organizer", "timeline", userId, eventId, filters, page] as const,
};

// The audit vocabulary emitted by the backend services; the API accepts several actions.
export const EVENT_AUDIT_ACTIONS = [
  "event.updated", "event.capacity_changed", "event.published", "event.unpublished", "event.cancelled",
  "event.suspended", "event.unsuspended", "event.duplicated",
  "ticket_type.price_changed", "ticket_type.capacity_changed",
  "activation.terms_accepted", "activation.fee_paid", "activation.fee_failed", "activation.activated",
  "activation.suspended", "activation.reinstated", "order.confirmed", "order.cancelled", "order.refunded",
  "refund.initiated", "payment.succeeded", "payment.failed", "staff.assigned", "staff.removed",
  "ticket.checked_in", "ticket.check_in_reversed",
] as const;

// datetime-local has no offset. Round-trip the browser's local fields before
// sending UTC, rejecting impossible calendar dates and daylight-saving gaps.
const localDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1000) return null;
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute ? date : null;
};

export const timelineFilters = (since: string, until: string, actions: string[]):
  { filters: TimelineFilters; error?: never } | { filters?: never; error: "invalidDate" | "invalidRange" } => {
  const start = since ? localDate(since) : null;
  const end = until ? localDate(until) : null;
  if ((since && !start) || (until && !end)) return { error: "invalidDate" };
  if (start && end && end <= start) return { error: "invalidRange" };
  return { filters: {
    since: start?.toISOString(), until: end?.toISOString(), actions: [...new Set(actions)].sort(),
  } };
};
