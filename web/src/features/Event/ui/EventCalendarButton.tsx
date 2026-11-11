import { useTranslation } from "react-i18next";

import { eventsApi } from "../../../shared/api/events";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";

export const EventCalendarButton = ({ slug, cancelled }: { slug: string; cancelled: boolean }) => {
  const { t } = useTranslation();
  return <FileDownloadButton label={t(cancelled ? "event.calendarCancellation" : "event.addCalendar")}
    filename={`${slug}.ics`} getFile={() => eventsApi.calendar(slug)} />;
};
