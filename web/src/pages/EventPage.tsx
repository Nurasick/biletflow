import { AboutEvent } from "../features/Event/ui/AboutEvent/AboutEvent";
import { Breadcrumb } from "../features/Event/ui/Breadcrumb/Breadcrumb";
import { EventInfo } from "../features/Event/ui/EventInfo/EventInfo";
import { PurchasePanel } from "../features/Event/ui/PurchasePanel/PurchasePanel";
import { SessionList } from "../features/Event/ui/SessionList/SessionList";
import { useEventBooking } from "../hooks/useEventBooking";
import { DateSelector } from "../shared/DateSelector/DateSelector";

export const EventPage = () => {
  const booking = useEventBooking();

  return (
    <>
      <Breadcrumb />

      <main className="mx-auto flex max-w-6xl gap-7 px-7 py-6">
        <div className="min-w-0 flex-[1.6]">
          <EventInfo />

          <div className="my-6 h-px bg-[#D0D5DD]" />

          <div>
            <h2 className="text-[15px] font-semibold">
              Choose a date and time
            </h2>
            <DateSelector
              selectedDate={booking.selectedDate}
              onDateChange={booking.selectDate}
              className="mt-3"
            />
          </div>
          <SessionList
            halls={booking.halls}
            selectedSessionId={booking.selectedSessionId}
            onSelectSession={booking.selectSession}
          />
          <AboutEvent />
        </div>

        <PurchasePanel booking={booking} />
      </main>
    </>
  );
};
