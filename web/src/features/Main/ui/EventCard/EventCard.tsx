import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../../i18n/useLocale";
import type { PublicEvent } from "../../../../shared/api/events";

// Each card carries its event's slug, so it opens that event (audit #3).
export const EventCard = ({ event }: { event: PublicEvent }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: event.timezone,
  }).format(new Date(event.starts_at));

  return (
    <Link to={`/events/${event.slug}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]">
        {event.cover_image_url && <img src={event.cover_image_url} alt="" loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />}
        <span className="absolute left-3 top-3 rounded bg-[#101828] px-2 py-1 text-[10px] font-semibold text-white">
          {t(`organizerEvent.category.${event.category ?? "other"}`)}
        </span>
      </div>
      <h3 className="mt-3 font-semibold transition-colors group-hover:text-[#FF5C35]">{event.title}</h3>
      <p className="mt-1 text-sm text-[#667085]">{when} · {event.venue_name}</p>
    </Link>
  );
};
