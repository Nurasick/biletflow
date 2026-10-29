import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router-dom";

import { organizerEventKeys, useEventWorkflowSync } from "../features/Organizer/model/useEventLifecycle";
import { EventStatusBadge } from "../features/Organizer/ui/EventStatusBadge";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import { useLocale } from "../i18n/useLocale";
import { eventLifecycleApi } from "../shared/api/eventLifecycle";

export const OrganizerEventsPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { userId } = useOutletContext<{ userId: number }>();
  useEventWorkflowSync(userId);
  const events = useQuery({
    queryKey: organizerEventKeys.list(userId),
    queryFn: () => eventLifecycleApi.list(userId),
    retry: false,
  });
  return <OrganizerWorkspace>
    <h1 className="text-3xl font-bold tracking-tight">{t("eventWorkflow.myEvents")}</h1>
    <p className="mt-3 text-sm leading-6 text-[#667085]">{t("eventWorkflow.listDescription")}</p>
    {events.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-[#667085]">
      <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("eventWorkflow.loading")}
    </div> : events.isError ? <Alert role="alert" type="error" showIcon className="mt-6"
      title={t("eventWorkflow.loadError")}
      action={<Button onClick={() => void events.refetch()} loading={events.isFetching}>{t("common.retry")}</Button>} />
      : events.data.length === 0 ? <p className="mt-8 rounded-xl border border-[#D0D5DD] bg-white p-6 text-sm text-[#667085]">
        {t("eventWorkflow.empty")}
      </p> : <ul className="mt-6 space-y-4">
        {events.data.map((event) => <li key={event.id}
          className="rounded-xl border border-[#D0D5DD] bg-white p-5">
          <Link to={`/organizer/events/${event.id}/preview`}
            className="flex flex-wrap items-center justify-between gap-4 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5C35]">
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-lg font-semibold">{event.title}</h2>
              <p className="mt-2 text-xs text-[#667085]">{new Intl.DateTimeFormat(locale, {
                dateStyle: "long", timeStyle: "short", timeZone: event.timezone,
              }).format(new Date(event.starts_at))} · {event.timezone}</p>
            </div>
            <EventStatusBadge status={event.status} />
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#A93216]">
              {t("eventWorkflow.preview")}<ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
          {(event.status === "draft" || event.status === "published") && <Link to={`/organizer/events/${event.id}/edit`}
            className="mt-4 inline-flex rounded-lg border border-[#D0D5DD] px-4 py-2 text-sm font-semibold text-[#A93216] hover:border-[#FF5C35] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C35]">
            {t("eventWorkflow.editDetails")}
          </Link>}
        </li>)}
      </ul>}
  </OrganizerWorkspace>;
};
