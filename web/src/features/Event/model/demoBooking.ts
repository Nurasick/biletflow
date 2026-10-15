import type { TFunction } from "i18next";

import { formatPrice } from "../../../shared/lib/formatPrice";

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
  id: string;
  name: string;
  note: string;
  price: number;
};

// Only these local demo labels are translated. Replace this fixture with raw
// event data when the service is connected; never use service values as keys.
export const getDemoBooking = (t: TFunction, locale: string): { halls: EventHall[]; ticketTypes: TicketType[] } => {
  const from = (price: number) => t("common.fromPrice", { price: formatPrice(price, locale) });
  return {
    halls: [
      {
        name: t("demo.mainHall"),
        capacity: t("booking.seats", { count: 1200 }),
        sessions: [
          { id: "main-1700", time: "17:00", price: from(8500) },
          { id: "main-1900", time: "19:00", price: from(8500) },
          { id: "main-2130", time: "21:30", price: from(6000) },
        ],
      },
      {
        name: t("demo.smallHall"),
        capacity: t("booking.seats", { count: 180 }),
        sessions: [
          { id: "small-1830", time: "18:30", price: formatPrice(5000, locale) },
          { id: "small-2030", time: "20:30", price: formatPrice(5000, locale) },
          { id: "small-2200", time: "22:00", price: t("booking.soldOut"), soldOut: true },
        ],
      },
      {
        name: t("demo.terrace"),
        capacity: t("booking.standing"),
        sessions: [
          { id: "terrace-1930", time: "19:30", price: from(4000) },
          { id: "terrace-2200", time: "22:00", price: from(4000) },
        ],
      },
    ],
    ticketTypes: [
      { id: "standard", name: t("demo.standard"), note: t("demo.mainHallNote"), price: 8500 },
      { id: "student", name: t("demo.student"), note: t("demo.studentNote"), price: 6000 },
      { id: "vip", name: t("demo.vip"), note: t("demo.vipNote"), price: 12000 },
    ],
  };
};
