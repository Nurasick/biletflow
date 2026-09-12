import type { EventBooking } from "../../../../hooks/useEventBooking";
import { formatPrice } from "../../../../shared/lib/formatPrice";

type PurchasePanelProps = {
  booking: EventBooking;
};

export const PurchasePanel = ({ booking }: PurchasePanelProps) => {
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
            {selectedSession?.hall} · sales close one hour before
          </p>
        </div>

        {ticketTypes.map((ticket) => (
          <div
            key={ticket.name}
            className="flex items-center justify-between gap-3 border-b border-[#D0D5DD] p-4"
          >
            <div>
              <h3 className="text-sm font-semibold">{ticket.name}</h3>
              <p className="mt-1 text-xs text-[#667085]">{ticket.note}</p>
              <p className="mt-1.5 text-sm font-semibold">
                {formatPrice(ticket.price)}
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 text-sm font-semibold">
              <button
                type="button"
                aria-label={`Remove one ${ticket.name} ticket`}
                disabled={quantities[ticket.name] === 0}
                onClick={() => changeQuantity(ticket.name, -1)}
                className="text-[#667085] disabled:opacity-30"
              >
                −
              </button>
              <span className="min-w-3 text-center">{quantities[ticket.name]}</span>
              <button
                type="button"
                aria-label={`Add one ${ticket.name} ticket`}
                disabled={isOrderLimitReached}
                onClick={() => changeQuantity(ticket.name, 1)}
                className="text-[#FF5C35] disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        ))}

        <div className="p-4">
          <div className="flex justify-between text-sm text-[#667085]">
            <span>Subtotal</span>
            <span className="font-semibold text-[#101828]">
              {formatPrice(subtotal)}
            </span>
          </div>
          <button
            type="button"
            disabled={totalTickets === 0}
            onClick={reserveTickets}
            className="mt-3 w-full rounded-lg bg-[#FF5C35] px-4 py-3 text-sm font-semibold text-[#101828] disabled:cursor-not-allowed disabled:bg-[#EAECF0] disabled:text-[#98A2B3]"
          >
            {totalTickets === 0
              ? "Select tickets"
              : `Continue with ${totalTickets} ${totalTickets === 1 ? "ticket" : "tickets"}`}
          </button>
          {reservationMessage && (
            <div
              role="status"
              className="mt-3 rounded-lg bg-[#ECFDF3] px-3 py-2 text-center text-xs font-semibold text-[#027A48]"
            >
              {reservationMessage}
            </div>
          )}
          <p className="mt-2 text-center text-[11px] leading-5 text-[#667085]">
            Max {orderLimit} per order · seats held 15 min
          </p>
        </div>
      </div>

      <div className="mt-3.5 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] p-3.5 text-xs leading-6 text-[#344054]">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
          Buying safely
        </h3>
        <p>Organizer identity and payout verified</p>
        <p>Full refund until 11 Apr</p>
        <p>Support case from any order</p>
      </div>
    </aside>
  );
};
