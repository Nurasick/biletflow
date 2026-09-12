import { EventCard } from "../features/Main/ui/EventCard/EventCard";
import { Hero } from "../features/Main/ui/Hero/Hero";
import { useDateSelection } from "../hooks/useDateSelection";
import { DateSelector } from "../shared/DateSelector/DateSelector";

const events = [
  {
    age: 12,
    price: 5000,
    title: "Live Orchestra",
    time: "18:30",
    venue: "Central Concert Hall",
  },
  {
    age: 18,
    price: 7500,
    title: "Stand-up Night",
    time: "20:00",
    venue: "Almaty Theatre",
  },
  {
    age: 6,
    price: 3500,
    title: "Family Theatre",
    time: "15:00",
    venue: "Drama Theatre",
  },
  {
    age: 12,
    price: 6000,
    title: "Jazz Evening",
    time: "21:00",
    venue: "Music Hall",
  },
];

export const HomePage = () => {
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
            Afisha · {selectedDateLabel}
          </h2>

          <div className="text-sm text-[#667085]">
            28 events ·{" "}
            <button className="font-semibold text-[#101828]">
              Popular ▾
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
                title={event.title}
                time={event.time}
                venue={event.venue}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
};
