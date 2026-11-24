import { CalendarDays, ChevronDown, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { storedEventAccess } from "../../../shared/api/eventAccess";
import { eventsApi, type CalendarLinks } from "../../../shared/api/events";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";

type Props = {
  slug: string;
  cancelled: boolean;
  links?: CalendarLinks | null;
  accessToken?: string | null;
  accessibleLabel?: string;
  getFile?: () => Promise<Blob>;
};

const providers = [
  ["google", "booking.calendarGoogle"],
  ["outlook", "booking.calendarOutlook"],
  ["yahoo", "booking.calendarYahoo"],
] as const;

export const EventCalendarButton = ({ slug, cancelled, links, accessToken, accessibleLabel, getFile }: Props) => {
  const { t } = useTranslation();
  const label = t(cancelled ? "event.calendarCancellation" : "event.addCalendar");
  const download = getFile ?? (() => eventsApi.calendar(slug, accessToken ?? storedEventAccess(slug)));

  if (cancelled || !links) {
    return <FileDownloadButton label={label} accessibleLabel={accessibleLabel} filename={`${slug}.ics`} getFile={download} />;
  }

  return (
    <details className="group max-w-full min-w-0" onKeyDown={(event) => {
      if (event.key === "Escape" && event.currentTarget.open) {
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}>
      <summary aria-label={accessibleLabel} className="action-button min-h-10 list-none [&::-webkit-details-marker]:hidden">
        <CalendarDays size={16} className="shrink-0" aria-hidden="true" />
        {label}
        <ChevronDown size={15} className="shrink-0 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="mt-1 rounded-xl border border-line-soft bg-paper p-1.5 text-sm">
        {providers.map(([provider, key]) => (
          <li key={provider}>
            <a href={links[provider]} target="_blank" rel="noopener noreferrer"
              className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2.5 font-medium text-muted-strong hover:bg-soft hover:text-primary">
              {t(key)}
              <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
            </a>
          </li>
        ))}
        <li className="mt-1 border-t border-line-soft px-2.5 py-2">
          <FileDownloadButton label={t("booking.calendarDownload")} filename={`${slug}.ics`} getFile={download} />
        </li>
      </ul>
    </details>
  );
};
