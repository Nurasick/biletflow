import type { AnalyticsFilters } from "../../../shared/api/eventReports";
import { readEventLocalTime } from "./eventDateTime";

export const eventAnalyticsKey = (userId: number, eventId: number, filters: AnalyticsFilters) =>
  ["organizer", "analytics", userId, eventId, filters] as const;

export const analyticsFilters = (since: string, until: string, ticketType: string, timeZone: string) => {
  const start = readEventLocalTime(since, timeZone);
  const end = readEventLocalTime(until, timeZone);
  const error = start.error ?? end.error;
  if (error) return { error };
  if (start.instant && end.instant && Date.parse(end.instant) <= Date.parse(start.instant)) {
    return { error: "reports.invalidRange" } as const;
  }
  return { filters: {
    since: start.instant ?? undefined,
    until: end.instant ?? undefined,
    ticketTypeId: ticketType ? Number(ticketType) : undefined,
  } };
};
