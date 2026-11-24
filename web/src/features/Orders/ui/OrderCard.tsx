import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { ordersApi } from "../../../shared/api/events";
import type { Order, OrderTicket } from "../../../shared/api/events";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";
import { EventCalendarButton } from "../../Event/ui/EventCalendarButton";
import { SupportRequestButton } from "../../Support/ui/SupportRequestButton";
import { TicketQr } from "./TicketQr";

const printable = (ticket: OrderTicket) => ticket.status === "valid" || ticket.status === "checked_in";

type Props = { order: Order; showQr?: boolean; detailHref?: string; access?: { token: string | null }; showCalendar?: boolean };

export const OrderCard = ({ order, showQr = true, detailHref, access, showCalendar = false }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "full", timeStyle: "short", timeZone: order.event.timezone,
  }).format(new Date(order.event.starts_at));
  const supportTarget = {
    audience: "attendee" as const,
    event_id: order.event_id,
    order_number: order.order_number,
    ...(access?.token && { order_token: access.token }),
  };
  const hasBreakdown = order.subtotal_minor > 0 || Boolean(order.promo_code);
  const cancelled = order.event.status === "cancelled";
  const canShowCalendar = (access || showCalendar) && order.event.status !== "draft"
    && (order.tickets.some(printable) || (cancelled && order.tickets.length > 0));
  const calendarProps = {
    slug: order.event.slug,
    cancelled,
    links: order.event.calendar_links,
    getFile: () => ordersApi.calendar(order.order_number, access?.token ?? null),
  };

  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/events/${order.event.slug}`} className="text-lg font-extrabold tracking-tight wrap-anywhere hover:text-primary">{order.event.title}</Link>
          <p className="mt-1 text-sm text-muted">{when} · {order.event.venue_name}</p>
          <p className="mt-1 font-mono text-xs text-muted">{order.order_number}</p>
          {detailHref && <Link to={detailHref} className="mt-2 inline-block text-sm font-semibold text-primary-hover">{t("orders.open")}</Link>}
        </div>
        <div className="text-right">
          <p className={`rounded-full px-3 py-1.5 text-xs font-bold ${order.status === "confirmed" ? "bg-emerald-50 text-emerald-800" : order.status === "pending" ? "bg-amber-50 text-amber-800" : "bg-soft text-muted-strong"}`}>{t(`orderStatus.${order.status}`)}</p>
          {!hasBreakdown && <p className="mt-2 text-sm font-semibold">{t("eventWorkflow.free")}</p>}
        </div>
      </div>
      {hasBreakdown && <dl className="mt-4 max-w-sm space-y-1.5 border-t border-line-soft pt-3 text-sm text-muted-strong">
        <div className="flex justify-between gap-3">
          <dt>{t("booking.subtotal")}</dt><dd>{formatMinor(order.subtotal_minor, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3 text-[#027A48]">
          <dt className="min-w-0 break-words">{order.promo_code ? t("orders.promoDiscount", { code: order.promo_code }) : t("promo.discount")}</dt>
          <dd className="shrink-0">{formatMinor(0 - order.discount_minor, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t("checkout.processingFee")}</dt><dd>{formatMinor(order.fee_minor, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3 font-bold">
          <dt>{t("checkout.total")}</dt><dd>{formatMinor(order.total_minor, locale)}</dd>
        </div>
      </dl>}
      {(access || canShowCalendar) && <div className="mt-4 flex flex-wrap items-start gap-2">
        {access && order.tickets.some(printable) && <FileDownloadButton label={t("orders.downloadAll")}
          filename={`biletflow-${order.order_number}.pdf`}
          getFile={() => ordersApi.ticketsPdf(order.order_number, access.token)} />}
        {canShowCalendar && <EventCalendarButton {...calendarProps} />}
        {access && <SupportRequestButton target={supportTarget} eventTitle={order.event.title} label={t("support.orderHelp")} />}
      </div>}
      {order.tickets.length > 0 && <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {order.tickets.map((ticket) => <li key={ticket.public_code} className="flex flex-wrap gap-4 rounded-xl border border-dashed border-line bg-paper p-4">
          {showQr && ticket.qr_payload
            ? <TicketQr payload={ticket.qr_payload} label={t("orders.qrLabel", { code: ticket.public_code })} />
            : null}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{ticket.attendee_name}</p>
            <p className="text-muted">{ticket.ticket_type_name}</p>
            {ticket.seat_number && <p className="mt-1 font-semibold text-muted-strong">{t("booking.assignedSeat", {
              seat: ticket.seat_label || [ticket.section_name, ticket.row_label, ticket.seat_number].filter(Boolean).join(" · "),
            })}</p>}
            <p className="mt-2 font-mono text-xs">{ticket.public_code}</p>
            <p className="mt-1 text-xs font-semibold">{t(`ticketStatus.${ticket.status}`)}</p>
            {(access || canShowCalendar) && <div className="mt-2 flex flex-wrap items-start gap-2">
              {access && printable(ticket) && <FileDownloadButton label={t("orders.downloadTicket")} accessibleLabel={t("orders.downloadTicketFor", { code: ticket.public_code })}
                filename={`biletflow-${ticket.public_code}.pdf`}
                getFile={() => ordersApi.ticketsPdf(order.order_number, access.token, ticket.public_code)} />}
              {canShowCalendar && (printable(ticket) || cancelled) && <EventCalendarButton {...calendarProps}
                accessibleLabel={t("booking.calendarTicket", {
                  action: t(cancelled ? "event.calendarCancellation" : "event.addCalendar"), code: ticket.public_code,
                })} />}
              {access && <SupportRequestButton target={{ ...supportTarget, ticket_code: ticket.public_code }} eventTitle={order.event.title}
                label={t("support.ticketHelp")} accessibleLabel={t("support.ticketHelpFor", { code: ticket.public_code })} />}
            </div>}
          </div>
        </li>)}
      </ul>}
    </article>
  );
};
