import { useMemo, useState } from "react";

import { useDateSelection } from "./useDateSelection";

export type EventSession = {
  id: string;
  time: string;
  price: string;
  soldOut?: boolean;
};

export type EventHall = {
  name: string;
  capacity: string;
  sessions: EventSession[];
};

export type TicketType = {
  name: string;
  note: string;
  price: number;
};

const halls: EventHall[] = [
  {
    name: "Main hall · assigned seating",
    capacity: "1 200 seats",
    sessions: [
      { id: "main-1700", time: "17:00", price: "from 8 500 ₸" },
      { id: "main-1900", time: "19:00", price: "from 8 500 ₸" },
      { id: "main-2130", time: "21:30", price: "from 6 000 ₸" },
    ],
  },
  {
    name: "Small hall · general admission",
    capacity: "180 seats",
    sessions: [
      { id: "small-1830", time: "18:30", price: "5 000 ₸" },
      { id: "small-2030", time: "20:30", price: "5 000 ₸" },
      { id: "small-2200", time: "22:00", price: "sold out", soldOut: true },
    ],
  },
  {
    name: "Open-air terrace",
    capacity: "standing",
    sessions: [
      { id: "terrace-1930", time: "19:30", price: "from 4 000 ₸" },
      { id: "terrace-2200", time: "22:00", price: "from 4 000 ₸" },
    ],
  },
];

const ticketTypes: TicketType[] = [
  { name: "Standard", note: "Main hall", price: 8500 },
  { name: "Student", note: "Student ID required", price: 6000 },
  { name: "VIP", note: "Best view", price: 12000 },
];

const initialQuantities = Object.fromEntries(
  ticketTypes.map((ticket) => [ticket.name, 0]),
);

const orderLimit = 6;

export const useEventBooking = () => {
  const dateSelection = useDateSelection();
  const [selectedSessionId, setSelectedSessionId] = useState("main-1900");
  const [quantities, setQuantities] =
    useState<Record<string, number>>(initialQuantities);
  const [reservationMessage, setReservationMessage] = useState<string | null>(
    null,
  );

  const selectedSession = useMemo(
    () =>
      halls
        .flatMap((hall) =>
          hall.sessions.map((session) => ({ ...session, hall: hall.name })),
        )
        .find((session) => session.id === selectedSessionId),
    [selectedSessionId],
  );

  const totalTickets = useMemo(
    () => Object.values(quantities).reduce((total, count) => total + count, 0),
    [quantities],
  );

  const subtotal = useMemo(
    () =>
      ticketTypes.reduce(
        (total, ticket) => total + ticket.price * quantities[ticket.name],
        0,
      ),
    [quantities],
  );

  const selectDate = (date: Date | null) => {
    dateSelection.setSelectedDate(date);
    setReservationMessage(null);
  };

  const selectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setReservationMessage(null);
  };

  const changeQuantity = (ticketName: string, change: number) => {
    setQuantities((current) => {
      const currentTotal = Object.values(current).reduce(
        (total, count) => total + count,
        0,
      );
      const nextQuantity = Math.max(0, current[ticketName] + change);
      const nextTotal = currentTotal - current[ticketName] + nextQuantity;

      if (nextTotal > orderLimit) {
        return current;
      }

      return { ...current, [ticketName]: nextQuantity };
    });
    setReservationMessage(null);
  };

  const reserveTickets = () => {
    if (!selectedSession || totalTickets === 0) {
      return;
    }

    setReservationMessage(
      `${totalTickets} ${totalTickets === 1 ? "ticket" : "tickets"} held for ${selectedSession.time}`,
    );
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
