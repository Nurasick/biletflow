import type { EventHall } from "../../../../hooks/useEventBooking";

type SessionListProps = {
  halls: EventHall[];
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
};

export const SessionList = ({
  halls,
  selectedSessionId,
  onSelectSession,
}: SessionListProps) => {
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
                key={session.id}
                type="button"
                disabled={session.soldOut}
                aria-pressed={selectedSessionId === session.id}
                onClick={() => onSelectSession(session.id)}
                className={`min-w-20 rounded-lg border px-3 py-2 text-center ${
                  selectedSessionId === session.id
                    ? "border-[#FF5C35] bg-orange-50"
                    : "border-[#D0D5DD] hover:border-[#98A2B3]"
                } ${session.soldOut ? "bg-[#F5F5F0] opacity-50" : ""}`}
              >
                <div
                  className={`text-[15px] font-semibold ${
                    selectedSessionId === session.id ? "text-[#FF5C35]" : ""
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
