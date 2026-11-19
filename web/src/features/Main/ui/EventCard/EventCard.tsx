import { ArrowUpRight, CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../../i18n/useLocale";
import type { PublicEvent } from "../../../../shared/api/events";
import { eventImageSrc } from "../../../../shared/api/urls";
import { categoryIcons } from "../../model/eventCategories";

export const EventCard = ({ event }: { event: PublicEvent }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const category = event.category ?? "other";
  const CategoryIcon = categoryIcons[category];
  const when = new Intl.DateTimeFormat(locale, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: event.timezone,
  }).format(new Date(event.starts_at));

  return (
    <Link to={`/events/${event.slug}`} className="panel group flex min-w-0 flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-[0_12px_26px_#21183c10]">
      <div className="relative isolate aspect-[16/10] overflow-hidden bg-accent-wash">
        {event.cover_image_url ? (
          <img src={eventImageSrc(event.cover_image_url)} alt="" loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035]" />
        ) : (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_60%_25%,#faf8ff,#dcd2ff)]" aria-hidden="true">
            <CategoryIcon className="size-[24%] -rotate-12 text-primary/55" strokeWidth={1.2} />
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-ink">{t(`organizerEvent.category.${category}`)}</span>
      </div>
      <div className="flex flex-1 items-end gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <time dateTime={event.starts_at} className="flex flex-wrap items-center gap-x-1.5 text-xs font-bold text-primary">
            <CalendarDays size={14} aria-hidden="true" />{when}
          </time>
          <h3 className="mt-2 text-lg leading-tight font-extrabold tracking-[-0.035em] wrap-anywhere sm:text-xl">{event.title}</h3>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-muted"><MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="wrap-anywhere">{event.venue_name}</span></p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-primary group-hover:border-primary group-hover:bg-accent-wash" aria-hidden="true">
          <ArrowUpRight size={17} />
        </span>
      </div>
    </Link>
  );
};
