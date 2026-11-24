import { Alert } from "antd";
import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../../i18n/useLocale";
import type { EventDetail } from "../../../../shared/api/events";
import { eventImageSrc } from "../../../../shared/api/urls";
import { SupportRequestButton } from "../../../Support/ui/SupportRequestButton";
import { EventCalendarButton } from "../EventCalendarButton";
import { ReportEventButton } from "../ReportEventButton";

export const EventDetails = ({ event, accessToken }: { event: EventDetail; accessToken?: string | null }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: event.timezone });
  const gallery = event.images.filter((image) => image.url !== event.cover_image_url);

  return (
    <article className="min-w-0 space-y-6">
      <div className="panel overflow-hidden">
        {event.cover_image_url && (
          <div className="grid min-h-40 place-items-center bg-stage">
            <img src={eventImageSrc(event.cover_image_url)} alt="" fetchPriority="high" className="max-h-[28rem] w-full object-contain" />
          </div>
        )}
        <div className="px-5 py-6 sm:px-7 sm:py-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-3 py-1.5 text-xs font-bold text-primary">
            <Ticket size={15} aria-hidden="true" />{t(`organizerEvent.category.${event.category ?? "other"}`)}
          </span>
          <h1 className="page-title mt-3">{event.title}</h1>
          <p className="mt-2 text-sm font-medium text-muted">{event.organizer_name}</p>
          {event.status !== "published" && <Alert type="error" showIcon className="mt-4"
            title={t(`eventWorkflow.state.${event.status}`)} description={t("event.notOnSale")} />}
          {event.phase === "completed" && <Alert type="info" showIcon className="mt-4" title={t("event.completed")} />}

          <div className="mt-6 grid gap-4 border-t border-line-soft pt-5 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-wash text-primary"><CalendarDays size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <time dateTime={event.starts_at} className="block text-sm font-bold">{dateTime.format(new Date(event.starts_at))}</time>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t("eventWorkflow.ends", { date: dateTime.format(new Date(event.ends_at)) })} · {event.timezone}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-wash text-primary"><MapPin size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold wrap-anywhere">{event.venue_name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted wrap-anywhere">{event.venue_address}</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-start gap-2">
            <EventCalendarButton slug={event.slug} cancelled={event.status === "cancelled"}
              links={event.calendar_links} accessToken={accessToken} />
            <SupportRequestButton target={{ audience: "attendee", event_id: event.id }}
              eventTitle={event.title} label={t("support.contactOrganizer")} />
            <ReportEventButton key={event.slug} slug={event.slug} title={event.title} />
          </div>
        </div>
      </div>
      {event.description && <section className="panel p-5 sm:p-7" aria-labelledby="about">
        <h2 id="about" className="text-xl font-extrabold tracking-tight">{t("event.about")}</h2>
        <p className="mt-3 max-w-prose text-[0.9375rem] leading-7 whitespace-pre-wrap text-muted-strong wrap-anywhere">{event.description}</p>
      </section>}
      {gallery.length > 0 && <div className="grid grid-cols-2 gap-3">
        {gallery.map((image) => <img key={image.id} src={eventImageSrc(image.url)} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-2xl bg-soft object-cover" />)}
      </div>}
      <section className="panel p-5 sm:p-7" aria-labelledby="refunds">
        <h2 id="refunds" className="text-xl font-extrabold tracking-tight">{t("event.refundRules")}</h2>
        <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-strong wrap-anywhere">{event.refund_policy || t("event.noRefundPolicy")}</p>
      </section>
    </article>
  );
};
