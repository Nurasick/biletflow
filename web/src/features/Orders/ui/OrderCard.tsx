import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import type { Order } from "../../../shared/api/events";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { TicketQr } from "./TicketQr";

// One order with its tickets. Only valid or checked-in tickets carry a QR;
// cancelled and refunded ones show their status instead (§4.9).
export const OrderCard = ({ order, showQr = true, detailHref }: { order: Order; showQr?: boolean; detailHref?: string }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "full", timeStyle: "short", timeZone: order.event.timezone,
  }).format(new Date(order.event.starts_at));

  return (
    <article className="rounded-2xl border border-[#D0D5DD] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/events/${order.event.slug}`} className="text-lg font-semibold hover:text-[#FF5C35]">{order.event.title}</Link>
          <p className="mt-1 text-sm text-[#667085]">{when} · {order.event.venue_name}</p>
          <p className="mt-1 font-mono text-xs text-[#667085]">{order.order_number}</p>
          {detailHref && <Link to={detailHref} className="mt-2 inline-block text-sm font-semibold text-[#D9431F]">{t("orders.open")}</Link>}
        </div>
        <div className="text-right">
          <p className="rounded-full border border-[#D0D5DD] px-3 py-1 text-xs font-semibold">{t(`orderStatus.${order.status}`)}</p>
          <p className="mt-2 text-sm font-semibold">{order.total_minor === 0 ? t("eventWorkflow.free") : formatMinor(order.total_minor, locale)}</p>
        </div>
      </div>
      {order.tickets.length > 0 && <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {order.tickets.map((ticket) => <li key={ticket.public_code} className="flex gap-4 rounded-xl border border-[#EAECF0] p-4">
          {showQr && ticket.qr_payload
            ? <TicketQr payload={ticket.qr_payload} label={t("orders.qrLabel", { code: ticket.public_code })} />
            : null}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{ticket.attendee_name}</p>
            <p className="text-[#667085]">{ticket.ticket_type_name}</p>
            <p className="mt-2 font-mono text-xs">{ticket.public_code}</p>
            <p className="mt-1 text-xs font-semibold">{t(`ticketStatus.${ticket.status}`)}</p>
          </div>
        </li>)}
      </ul>}
    </article>
  );
};
