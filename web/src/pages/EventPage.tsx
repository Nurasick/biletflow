import { useState } from "react";

import { AboutEvent } from "../features/EventPage/ui/AboutEvent/AboutEvent";
import { Breadcrumb } from "../features/EventPage/ui/Breadcrumb/Breadcrumb";
import { EventInfo } from "../features/EventPage/ui/EventInfo/EventInfo";
import { PurchasePanel } from "../features/EventPage/ui/PurchasePanel/PurchasePanel";
import { SessionList } from "../features/EventPage/ui/SessionList/SessionList";
import { DateSelector } from "../shared/DateSelector/DateSelector";

export const EventPage = () => {
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });

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
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              className="mt-3"
            />
          </div>
          <SessionList />
          <AboutEvent />
        </div>

        <PurchasePanel />
      </main>
    </>
  );
};
