import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import type { EventPreview } from "../../../shared/api/eventLifecycle";
import { eventImageSrc } from "../../../shared/api/urls";

export const EventPreviewContent = ({ snapshot }: { snapshot: EventPreview }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { event, ticket_types } = snapshot;
  const dateTime = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "long", timeStyle: "short", timeZone: event.timezone,
  }).format(new Date(value));

  return (
    <article aria-label={t("eventWorkflow.previewContent")} className="overflow-hidden rounded-xl border border-line bg-white">
      {event.cover_image_url && <img src={eventImageSrc(event.cover_image_url)} alt="" className="max-h-80 w-full object-cover" />}
      <div className="space-y-7 p-5 sm:p-8">
        {snapshot.gallery_images.length > 0 && <div className="grid grid-cols-2 gap-3">
          {snapshot.gallery_images.map((source, index) => <img key={index} src={eventImageSrc(source)} alt=""
            className="h-36 w-full rounded-lg object-cover sm:h-44" />)}
        </div>}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-hover">
            {t(`organizerEvent.category.${event.category ?? "other"}`)}
          </p>
          <h2 className="mt-2 break-words text-3xl font-bold tracking-tight">{event.title}</h2>
        </div>
        <div className="grid gap-6 text-sm sm:grid-cols-2">
          <div className="flex gap-3">
            <CalendarDays size={20} className="mt-0.5 shrink-0 text-primary-hover" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("organizerEvent.schedule")}</p>
              <p className="mt-1">{dateTime(event.starts_at)}</p>
              <p className="mt-1 text-muted">{t("eventWorkflow.ends", { date: dateTime(event.ends_at) })}</p>
              <p className="mt-1 text-xs text-muted">{event.timezone}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <MapPin size={20} className="mt-0.5 shrink-0 text-primary-hover" aria-hidden="true" />
            <div className="min-w-0 break-words">
              <p className="font-semibold">{event.venue_name}</p>
              <p className="mt-1 text-muted">{event.venue_address}</p>
            </div>
          </div>
        </div>
        {event.description && <section aria-labelledby="preview-description">
          <h3 id="preview-description" className="font-semibold">{t("organizerEvent.description")}</h3>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-muted-strong">{event.description}</p>
        </section>}
        {event.refund_policy && <section aria-labelledby="preview-refund-policy">
          <h3 id="preview-refund-policy" className="font-semibold">{t("eventEdit.refundPolicy")}</h3>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-muted-strong">{event.refund_policy}</p>
        </section>}
        <section aria-labelledby="preview-tickets" className="border-t border-line-soft pt-6">
          <h3 id="preview-tickets" className="flex items-center gap-2 font-semibold">
            <Ticket size={18} aria-hidden="true" />{t("eventWorkflow.tickets")}
          </h3>
          <p className="mt-2 text-xs text-muted">{t("eventWorkflow.noPurchases")}</p>
          {ticket_types.length === 0 ? <p className="mt-4 text-sm text-muted">{t("eventWorkflow.noTickets")}</p> : (
            <ul className="mt-4 space-y-3">
              {ticket_types.map((ticket) => <li key={ticket.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line-soft p-4">
                <div className="min-w-0 flex-1 break-words">
                  <p className="text-sm font-semibold">{ticket.name}</p>
                  {ticket.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{ticket.description}</p>}
                  <p className="mt-2 text-xs text-muted">{t("eventWorkflow.available", { count: ticket.available })}</p>
                </div>
                <p className="text-sm font-semibold">{ticket.price_minor === 0 ? t("eventWorkflow.free") : new Intl.NumberFormat(locale, {
                  style: "currency", currency: ticket.currency,
                }).format(ticket.price_minor / 100)}</p>
              </li>)}
            </ul>
          )}
        </section>
        <dl className="grid gap-4 border-t border-line-soft pt-6 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">{t("organizerEvent.visibility")}</dt>
            <dd className="mt-1">{t(`organizerEvent.visibility.${event.visibility}`)}</dd></div>
          <div><dt className="text-xs text-muted">{t("organizerEvent.capacity")}</dt>
            <dd className="mt-1">{event.capacity === null ? t("organizerEvent.unlimited") : new Intl.NumberFormat(locale).format(event.capacity)}</dd></div>
          {event.registration_opens_at && <div><dt className="text-xs text-muted">{t("organizerEvent.registrationOpens")}</dt>
            <dd className="mt-1">{dateTime(event.registration_opens_at)}</dd></div>}
          {event.registration_closes_at && <div><dt className="text-xs text-muted">{t("organizerEvent.registrationCloses")}</dt>
            <dd className="mt-1">{dateTime(event.registration_closes_at)}</dd></div>}
        </dl>
      </div>
    </article>
  );
};
