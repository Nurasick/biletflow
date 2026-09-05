type Session = {
  time: string;
  price: string;
  selected?: boolean;
  soldOut?: boolean;
};

type Hall = {
  name: string;
  capacity: string;
  sessions: Session[];
};

const halls: Hall[] = [
  {
    name: "Main hall · assigned seating",
    capacity: "1 200 seats",
    sessions: [
      { time: "17:00", price: "from 8 500 ₸" },
      { time: "19:00", price: "from 8 500 ₸", selected: true },
      { time: "21:30", price: "from 6 000 ₸" },
    ],
  },
  {
    name: "Small hall · general admission",
    capacity: "180 seats",
    sessions: [
      { time: "18:30", price: "5 000 ₸" },
      { time: "20:30", price: "5 000 ₸" },
      { time: "22:00", price: "sold out", soldOut: true },
    ],
  },
  {
    name: "Open-air terrace",
    capacity: "standing",
    sessions: [
      { time: "19:30", price: "from 4 000 ₸" },
      { time: "22:00", price: "from 4 000 ₸" },
    ],
  },
];

export const SessionList = () => {
  return (
    <section className="mt-5 flex flex-col gap-4">
      {halls.map((hall) => (
        <div key={hall.name} className="border-b border-[#D0D5DD] pb-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">{hall.name}</h3>
            <span className="text-[11px] text-[#667085]">
              {hall.capacity}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {hall.sessions.map((session) => (
              <button
                key={session.time}
                disabled={session.soldOut}
                className={`min-w-20 rounded-lg border px-3 py-2 text-center ${
                  session.selected
                    ? "border-[#FF5C35] bg-orange-50"
                    : "border-[#D0D5DD]"
                } ${session.soldOut ? "bg-[#F5F5F0] opacity-50" : ""}`}
              >
                <div
                  className={`text-[15px] font-semibold ${
                    session.selected ? "text-[#FF5C35]" : ""
                  } ${session.soldOut ? "line-through" : ""}`}
                >
                  {session.time}
                </div>
                <div className="mt-1 text-[11px] text-[#667085]">
                  {session.price}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};
