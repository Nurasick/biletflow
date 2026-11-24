import { Accessibility } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../../i18n/useLocale";
import type { EventSeat, EventSeatMap } from "../../../../shared/api/events";
import { formatMinorCurrency } from "../../../../shared/lib/formatPrice";

const states = {
  available: { label: "booking.seatAvailable", symbol: "○", style: "border-line bg-paper" },
  selected: { label: "booking.seatSelected", symbol: "✓", style: "border-primary bg-accent-wash text-primary-hover" },
  held: { label: "booking.seatHeld", symbol: "◷", style: "border-amber-200 bg-amber-50 text-amber-900" },
  sold: { label: "booking.seatSold", symbol: "×", style: "border-line bg-soft text-muted-strong" },
  unavailable: { label: "booking.seatUnavailable", symbol: "–", style: "border-dashed border-line bg-soft text-muted" },
} as const;

type Props = {
  map: EventSeatMap;
  selected: ReadonlyMap<number, EventSeat>;
  canSelect: (seat: EventSeat) => boolean;
  onToggle: (seat: EventSeat) => void;
  disabled: boolean;
};

export const SeatMap = ({ map, selected, canSelect, onToggle, disabled }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const headingId = useId();

  return <section aria-labelledby={headingId} className="mt-4 rounded-xl border border-line-soft bg-soft p-3 sm:p-4">
    <h3 id={headingId} className="font-bold">{t("booking.seatMap")}</h3>
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-strong">
      {Object.values(states).map(({ label, symbol }) => <li key={label} className="flex items-center gap-1">
        <span aria-hidden="true" className="w-3 text-center font-bold">{symbol}</span>{t(label)}
      </li>)}
      <li className="flex items-center gap-1"><Accessibility size={14} aria-hidden="true" />{t("booking.seatAccessible")}</li>
    </ul>
    {map.sections.length === 0 && <p className="mt-3 text-sm text-muted">{t("booking.noSeats")}</p>}
    {map.sections.map((section) => <section key={section.section_id} className="mt-4 border-t border-line pt-3">
      <h4 className="text-sm font-bold">{section.name}</h4>
      {section.rows.map((row) => <div key={row.row_id} role="group" aria-label={t("booking.seatRow", { row: row.name })} className="mt-2">
        <p className="mb-1 text-xs font-semibold text-muted-strong">{t("booking.seatRow", { row: row.name })}</p>
        <div className="flex flex-wrap gap-1.5">
          {row.seats.map((seat) => {
            const { event_seat_id: id, status, is_accessible: accessible } = seat;
            const chosen = selected.has(id);
            const state = states[chosen && status === "available" ? "selected" : status];
            const inactive = disabled || (!chosen && !canSelect(seat));
            const price = seat.price_minor === null ? "" : formatMinorCurrency(seat.price_minor, seat.currency ?? "KZT", locale);
            const label = [seat.seat_label, t(state.label), accessible && t("booking.seatAccessible"), price].filter(Boolean).join(", ");
            return <button key={id} type="button" aria-label={label} aria-pressed={chosen} aria-disabled={inactive}
              tabIndex={inactive ? -1 : undefined} title={label} onClick={() => { if (!inactive) onToggle(seat); }}
              className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md border px-1.5 text-xs leading-tight font-semibold focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 aria-disabled:cursor-default ${state.style}`}>
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span>{state.symbol}</span><span>{seat.seat_number}</span>{accessible && <Accessibility size={12} />}
              </span>
              {price && <span className="mt-0.5 text-[0.65rem] font-medium" aria-hidden="true">{price}</span>}
            </button>;
          })}
        </div>
      </div>)}
    </section>)}
  </section>;
};
