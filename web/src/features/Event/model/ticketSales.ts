import type { EventDetail, PublicTicketType } from "../../../shared/api/events";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";

type SaleWindow = { opens: number; closes: number };

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
