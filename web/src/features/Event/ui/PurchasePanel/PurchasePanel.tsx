import { useTranslation } from "react-i18next";
import { useLocale } from "../../../../i18n/useLocale";
import type { EventBooking } from "../../../../hooks/useEventBooking";
import { formatPrice } from "../../../../shared/lib/formatPrice";

type PurchasePanelProps = {
  booking: EventBooking;
};

export const PurchasePanel = ({ booking }: PurchasePanelProps) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const refundDate = new Date(2026, 3, 11).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const {
    changeQuantity,
    isOrderLimitReached,
    orderLimit,
    quantities,
    reservationMessage,
    reserveTickets,
    selectedDateLabel,
    selectedSession,
    subtotal,
    ticketTypes,
    totalTickets,
  } = booking;

  return (
    <aside className="w-[300px] shrink-0">
      <div className="top-5 overflow-hidden rounded-xl border border-[#D0D5DD] shadow-sm">
        <div className="border-b border-[#D0D5DD] p-4">
          <h2 className="text-[15px] font-semibold">
            {selectedDateLabel} · {selectedSession?.time}
          </h2>
          <p className="mt-1 text-[11px] text-[#667085]">
            {selectedSession?.hall} · {t("booking.salesClose")}
          </p>
        </div>

        {ticketTypes.map((ticket) => (
          <div
            key={ticket.id}
            className="flex items-center justify-between gap-3 border-b border-[#D0D5DD] p-4"
          >
            <div>
              <h3 className="text-sm font-semibold">{ticket.name}</h3>
              <p className="mt-1 text-xs text-[#667085]">{ticket.note}</p>
              <p className="mt-1.5 text-sm font-semibold">
                {formatPrice(ticket.price, locale)}
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 text-sm font-semibold">
              <button
                type="button"
                aria-label={t("booking.removeTicket", { name: ticket.name })}
                disabled={quantities[ticket.id] === 0}
                onClick={() => changeQuantity(ticket.id, -1)}
                className="text-[#667085] disabled:opacity-30"
              >
                −
              </button>
              <span className="min-w-3 text-center">{quantities[ticket.id]}</span>
              <button
                type="button"
                aria-label={t("booking.addTicket", { name: ticket.name })}
                disabled={isOrderLimitReached}
                onClick={() => changeQuantity(ticket.id, 1)}
                className="text-[#FF5C35] disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        ))}

        <div className="p-4">
          <div className="flex justify-between text-sm text-[#667085]">
            <span>{t("booking.subtotal")}</span>
            <span className="font-semibold text-[#101828]">
              {formatPrice(subtotal, locale)}
            </span>
          </div>
          <button
            type="button"
            disabled={totalTickets === 0}
            onClick={reserveTickets}
            className="mt-3 w-full rounded-lg bg-[#FF5C35] px-4 py-3 text-sm font-semibold text-[#101828] disabled:cursor-not-allowed disabled:bg-[#EAECF0] disabled:text-[#98A2B3]"
          >
            {totalTickets === 0
              ? t("booking.selectTickets")
              : t("booking.continue", { count: totalTickets })}
          </button>
          {reservationMessage && (
            <div
              role="status"
              className="mt-3 rounded-lg bg-[#ECFDF3] px-3 py-2 text-center text-xs font-semibold text-[#027A48]"
            >
              {t("booking.held", reservationMessage)}
            </div>
          )}
          <p className="mt-2 text-center text-[11px] leading-5 text-[#667085]">
            {t("booking.orderLimit", { limit: orderLimit })}
          </p>
        </div>
      </div>

      <div className="mt-3.5 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] p-3.5 text-xs leading-6 text-[#344054]">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
          {t("booking.safety")}
        </h3>
        <p>{t("booking.verified")}</p>
        <p>{t("booking.refundUntil", { date: refundDate })}</p>
        <p>{t("booking.support")}</p>
      </div>
    </aside>
  );
};
