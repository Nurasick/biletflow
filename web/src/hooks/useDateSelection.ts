import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../i18n/useLocale";

const getToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export const useDateSelection = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [selectedDate, setSelectedDate] = useState<Date | null>(getToday);

  const selectedDateLabel = useMemo(
    () =>
      selectedDate?.toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }) ?? t("dates.all"),
    [selectedDate, locale, t],
  );

  return { selectedDate, selectedDateLabel, setSelectedDate };
};
