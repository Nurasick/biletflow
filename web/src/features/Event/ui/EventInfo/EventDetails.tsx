import { Alert } from "antd";
import { CalendarDays, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../../i18n/useLocale";
import type { EventDetail } from "../../../../shared/api/events";

export const EventDetails = ({ event }: { event: EventDetail }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const dateTime = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "full", timeStyle: "short", timeZone: event.timezone,
  }).format(new Date(value));
  const gallery = event.images.slice(1);

  return (
    <article>
      {event.status !== "published" && <Alert type="error" showIcon className="mb-5"
        title={t(`eventWorkflow.state.${event.status}`)} description={t("event.notOnSale")} />}
      {event.phase === "completed" && <Alert type="info" showIcon className="mb-5" title={t("event.completed")} />}
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="aspect-[2/3] w-full shrink-0 overflow-hidden rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] sm:w-[180px]">
          {event.cover_image_url && <img src={event.cover_image_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <span className="rounded-md bg-[#F5F5F0] px-2 py-1 text-[11px] font-semibold text-[#667085]">
            {t(`organizerEvent.category.${event.category ?? "other"}`)}
          </span>
          <h1 className="mt-3 break-words text-[27px] font-bold leading-tight tracking-tight">{event.title}</h1>
          <p className="mt-2 text-sm text-[#667085]">{event.organizer_name}</p>
          <div className="mt-4 space-y-3 text-sm">
            <p className="flex gap-2"><CalendarDays size={18} className="shrink-0 text-[#FF5C35]" aria-hidden="true" />
              <span>{dateTime(event.starts_at)}<span className="block text-xs text-[#667085]">{t("eventWorkflow.ends", { date: dateTime(event.ends_at) })} · {event.timezone}</span></span></p>
            <p className="flex gap-2"><MapPin size={18} className="shrink-0 text-[#FF5C35]" aria-hidden="true" />
              <span className="break-words">{event.venue_name}<span className="block text-xs text-[#667085]">{event.venue_address}</span></span></p>
          </div>
        </div>
      </div>
      {event.description && <section className="mt-8" aria-labelledby="about">
        <h2 id="about" className="text-[15px] font-semibold">{t("event.about")}</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#475467]">{event.description}</p>
      </section>}
      {gallery.length > 0 && <div className="mt-6 grid grid-cols-2 gap-3">
        {gallery.map((image) => <img key={image.id} src={image.url} alt="" loading="lazy" className="h-40 w-full rounded-lg object-cover" />)}
      </div>}
      {/* §4.9: the organizer's own words; the platform does not promise more (audit #20). */}
      <section className="mt-8 rounded-xl border border-[#D0D5DD] p-4" aria-labelledby="refunds">
        <h2 id="refunds" className="text-sm font-semibold">{t("event.refundRules")}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[#667085]">{event.refund_policy || t("event.noRefundPolicy")}</p>
      </section>
    </article>
  );
};
