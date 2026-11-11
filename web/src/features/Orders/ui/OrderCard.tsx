import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { ordersApi } from "../../../shared/api/events";
import type { Order, OrderTicket } from "../../../shared/api/events";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";
import { EventCalendarButton } from "../../Event/ui/EventCalendarButton";
import { TicketQr } from "./TicketQr";

const printable = (ticket: OrderTicket) => ticket.status === "valid" || ticket.status === "checked_in";

type Props = { order: Order; showQr?: boolean; detailHref?: string; downloads?: { token: string | null } };

export const OrderCard = ({ order, showQr = true, detailHref, downloads }: Props) => {
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
      {order.promo_code && <dl className="mt-4 max-w-xs space-y-1 border-t border-[#EAECF0] pt-3 text-sm text-[#475467]">
        <div className="flex justify-between gap-3">
          <dt>{t("booking.subtotal")}</dt><dd>{formatMinor(order.subtotal_minor, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3 text-[#027A48]">
          <dt className="min-w-0 break-words">{t("orders.promoDiscount", { code: order.promo_code })}</dt>
          <dd className="shrink-0">{formatMinor(0 - order.discount_minor, locale)}</dd>
        </div>
      </dl>}
      {downloads && <div className="mt-4 flex flex-wrap items-start gap-2">
        {order.tickets.some(printable) && <FileDownloadButton label={t("orders.downloadAll")}
          filename={`biletflow-${order.order_number}.pdf`}
          getFile={() => ordersApi.ticketsPdf(order.order_number, downloads.token)} />}
        {order.event.status !== "draft" && <EventCalendarButton key={order.event.slug}
          slug={order.event.slug} cancelled={order.event.status === "cancelled"} />}
      </div>}
      {order.tickets.length > 0 && <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {order.tickets.map((ticket) => <li key={ticket.public_code} className="flex flex-wrap gap-4 rounded-xl border border-[#EAECF0] p-4">
          {showQr && ticket.qr_payload
            ? <TicketQr payload={ticket.qr_payload} label={t("orders.qrLabel", { code: ticket.public_code })} />
            : null}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{ticket.attendee_name}</p>
            <p className="text-[#667085]">{ticket.ticket_type_name}</p>
            <p className="mt-2 font-mono text-xs">{ticket.public_code}</p>
            <p className="mt-1 text-xs font-semibold">{t(`ticketStatus.${ticket.status}`)}</p>
            {downloads && printable(ticket) && <div className="mt-2">
              <FileDownloadButton label={t("orders.downloadTicket")} accessibleLabel={t("orders.downloadTicketFor", { code: ticket.public_code })}
                filename={`biletflow-${ticket.public_code}.pdf`}
                getFile={() => ordersApi.ticketsPdf(order.order_number, downloads.token, ticket.public_code)} />
            </div>}
          </div>
        </li>)}
      </ul>}
    </article>
  );
};
