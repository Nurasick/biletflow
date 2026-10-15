import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDemoBooking } from "../features/Event/model/demoBooking";
import { useLocale } from "../i18n/useLocale";

import { useDateSelection } from "./useDateSelection";

export type { EventHall } from "../features/Event/model/demoBooking";

const initialQuantities = { standard: 0, student: 0, vip: 0 };

const orderLimit = 6;

export const useEventBooking = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { halls, ticketTypes } = useMemo(() => getDemoBooking(t, locale), [t, locale]);
  const dateSelection = useDateSelection();
  const [selectedSessionId, setSelectedSessionId] = useState("main-1900");
  const [quantities, setQuantities] =
    useState<Record<string, number>>(initialQuantities);
  const [reservationMessage, setReservationMessage] = useState<{ count: number; time: string } | null>(
    null,
  );

  const selectedSession = useMemo(
    () =>
      halls
        .flatMap((hall) =>
          hall.sessions.map((session) => ({ ...session, hall: hall.name })),
        )
        .find((session) => session.id === selectedSessionId),
    [selectedSessionId, halls],
  );

  const totalTickets = useMemo(
    () => Object.values(quantities).reduce((total, count) => total + count, 0),
    [quantities],
  );

  const subtotal = useMemo(
    () =>
      ticketTypes.reduce(
        (total, ticket) => total + ticket.price * quantities[ticket.id],
        0,
      ),
    [quantities, ticketTypes],
  );

  const selectDate = (date: Date | null) => {
    dateSelection.setSelectedDate(date);
    setReservationMessage(null);
  };

  const selectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setReservationMessage(null);
  };

  const changeQuantity = (ticketId: string, change: number) => {
    setQuantities((current) => {
      const currentTotal = Object.values(current).reduce(
        (total, count) => total + count,
        0,
      );
      const nextQuantity = Math.max(0, current[ticketId] + change);
      const nextTotal = currentTotal - current[ticketId] + nextQuantity;

      if (nextTotal > orderLimit) {
        return current;
      }

      return { ...current, [ticketId]: nextQuantity };
    });
    setReservationMessage(null);
  };

  const reserveTickets = () => {
    if (!selectedSession || totalTickets === 0) {
      return;
    }

    setReservationMessage({ count: totalTickets, time: selectedSession.time });
  };

  return {
    ...dateSelection,
    changeQuantity,
    halls,
    isOrderLimitReached: totalTickets === orderLimit,
    orderLimit,
    quantities,
    reservationMessage,
    reserveTickets,
    selectDate,
    selectSession,
    selectedSession,
    selectedSessionId,
    subtotal,
    ticketTypes,
    totalTickets,
  };
};

export type EventBooking = ReturnType<typeof useEventBooking>;
