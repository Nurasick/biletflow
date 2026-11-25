import type { EventDetail, PublicTicketType } from "../../../shared/api/events";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";

export type SaleWindow = { opens: number; closes: number };

export type ClosedSaleNotice =
  | { status: "upcoming"; opens: number }
  | { status: "closed" }
  | { status: "unavailable" };

export const ticketSaleWindow = (
  event: Pick<EventDetail, "registration_opens_at" | "registration_closes_at" | "ends_at">,
  ticket: Pick<PublicTicketType, "sales_start_at" | "sales_end_at">,
): SaleWindow => ({
  opens: Math.max(
    event.registration_opens_at ? parseApiInstant(event.registration_opens_at) : -Infinity,
    ticket.sales_start_at ? parseApiInstant(ticket.sales_start_at) : -Infinity,
  ),
  closes: Math.min(
    event.registration_closes_at ? parseApiInstant(event.registration_closes_at) : Infinity,
    ticket.sales_end_at ? parseApiInstant(ticket.sales_end_at) : Infinity,
    parseApiInstant(event.ends_at),
  ),
});

export const ticketSaleStatus = ({ opens, closes }: SaleWindow, now: number) => {
  if (opens >= closes) return "unavailable";
  if (now >= closes) return "closed";
  return now < opens ? "upcoming" : "open";
};

export const closedSaleNotice = (windows: readonly SaleWindow[], now: number): ClosedSaleNotice | null => {
  if (windows.length === 0) return null;
  let earliestOpen = Infinity;
  let hasClosed = false;
  for (const window of windows) {
    const status = ticketSaleStatus(window, now);
    if (status === "open") return null;
    if (status === "upcoming") earliestOpen = Math.min(earliestOpen, window.opens);
    else if (status === "closed") hasClosed = true;
  }
  if (Number.isFinite(earliestOpen)) return { status: "upcoming", opens: earliestOpen };
  return { status: hasClosed ? "closed" : "unavailable" };
};
