import { useMemo, useState } from "react";

const getToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export const useDateSelection = () => {
  const [selectedDate, setSelectedDate] = useState<Date | null>(getToday);

  const selectedDateLabel = useMemo(
    () =>
      selectedDate?.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }) ?? "All dates",
    [selectedDate],
  );

  return { selectedDate, selectedDateLabel, setSelectedDate };
};
