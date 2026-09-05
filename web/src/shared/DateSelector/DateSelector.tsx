type DateSelectorProps = {
  selectedDate: Date | null;
  onDateChange: (date: Date | null) => void;
  numberOfDays?: number;
  className?: string;
};

const getDatesFromToday = (numberOfDays: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: numberOfDays }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return date;
  });
};

export const DateSelector = ({
  selectedDate,
  onDateChange,
  numberOfDays = 6,
  className = "mt-7",
}: DateSelectorProps) => {
  const dates = getDatesFromToday(numberOfDays);

  return (
    <section
      aria-label="Choose an event date"
      className={`flex gap-2 overflow-x-auto ${className}`}
    >
      {dates.map((date) => {
        const isSelected = selectedDate?.getTime() === date.getTime();
        const day = date.toLocaleDateString("en-US", { weekday: "short" });

        return (
          <button
            key={date.toISOString()}
            type="button"
            aria-label={date.toLocaleDateString("en-US", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            aria-pressed={isSelected}
            onClick={() => onDateChange(date)}
            className={`min-w-16 cursor-pointer rounded-xl border px-3 py-2 transition-colors ${
              isSelected
                ? "border-[#101828] bg-[#101828] text-white"
                : "border-[#D0D5DD] bg-white text-[#101828] hover:bg-[#F9FAFB]"
            }`}
          >
            <span
              className={`block text-[11px] uppercase ${
                isSelected ? "text-[#98A2B3]" : "text-[#667085]"
              }`}
            >
              {day}
            </span>
            <span className="mt-1 block font-semibold">{date.getDate()}</span>
          </button>
        );
      })}

      <button
        type="button"
        aria-pressed={selectedDate === null}
        onClick={() => onDateChange(null)}
        className={`min-w-24 cursor-pointer rounded-xl border px-4 text-sm transition-colors ${
          selectedDate === null
            ? "border-[#101828] bg-[#101828] text-white"
            : "border-[#D0D5DD] bg-white text-[#667085] hover:bg-[#F9FAFB]"
        }`}
      >
        All dates
      </button>
    </section>
  );
};
