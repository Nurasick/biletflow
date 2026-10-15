import { useTranslation } from "react-i18next";

import { EventCard } from "../features/Main/ui/EventCard/EventCard";
import { Hero } from "../features/Main/ui/Hero/Hero";
import { useDateSelection } from "../hooks/useDateSelection";
import { DateSelector } from "../shared/DateSelector/DateSelector";

const events = [
  {
    age: 12,
    price: 5000,
    title: "demo.liveOrchestra",
    time: "18:30",
    venue: "demo.centralHall",
  },
  {
    age: 18,
    price: 7500,
    title: "demo.standup",
    time: "20:00",
    venue: "demo.almatyTheatre",
  },
  {
    age: 6,
    price: 3500,
    title: "demo.familyTheatre",
    time: "15:00",
    venue: "demo.dramaTheatre",
  },
  {
    age: 12,
    price: 6000,
    title: "demo.jazz",
    time: "21:00",
    venue: "demo.musicHall",
  },
] as const;

export const HomePage = () => {
  const { t } = useTranslation();
  const { selectedDate, selectedDateLabel, setSelectedDate } =
    useDateSelection();

  return (
    <main className="mx-auto max-w-7xl px-7 py-6">
      <Hero />

      <DateSelector
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
      />

      <section className="mt-8">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("nav.afisha")} · {selectedDateLabel}
          </h2>

          <div className="text-sm text-[#667085]">
            {t("common.events", { count: 28 })} ·{" "}
            <button className="font-semibold text-[#101828]">
              {t("home.popular")} ▾
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
          {events.map((event, index) => {
            return (
              <EventCard
                key={index}
                age={event.age}
                price={event.price}
                title={t(event.title)}
                time={event.time}
                venue={t(event.venue)}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
};
