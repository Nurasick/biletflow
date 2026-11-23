import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";

import { organizerEventKeys, useEventWorkflowSync } from "../features/Organizer/model/useEventLifecycle";
import { EventStatusBadge } from "../features/Organizer/ui/EventStatusBadge";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import { useLocale } from "../i18n/useLocale";
import { eventLifecycleApi } from "../shared/api/eventLifecycle";
import type { EventPhase } from "../shared/api/organizerEvents";

const phases = ["upcoming", "active", "completed", "cancelled", "draft", "suspended"] as const satisfies readonly EventPhase[];

export const OrganizerEventsPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { userId } = useOutletContext<{ userId: number }>();
  const [params] = useSearchParams();
  const selectedPhase = phases.find((phase) => phase === params.get("phase"));
  const eventsSearch = selectedPhase ? `?phase=${selectedPhase}` : "";
  useEventWorkflowSync(userId);
  const events = useQuery({
    queryKey: organizerEventKeys.list(userId),
    queryFn: () => eventLifecycleApi.list(userId),
    retry: false,
    refetchInterval: 30_000,
  });
  const visibleEvents = events.data?.filter((event) => !selectedPhase || event.phase === selectedPhase) ?? [];
  return <OrganizerWorkspace>
    <h1 className="page-title">{t("eventWorkflow.myEvents")}</h1>
    <p className="mt-3 text-sm leading-6 text-muted">{t("eventWorkflow.listDescription")}</p>
    <nav aria-label={t("eventWorkflow.filterPhase")} className="mt-5 flex flex-wrap gap-2">
      {[undefined, ...phases].map((phase) => <Link key={phase ?? "all"}
        to={{ search: phase ? `?phase=${phase}` : "" }} preventScrollReset
        aria-current={selectedPhase === phase ? "true" : undefined}
        className={`action-button min-h-10 px-3 py-1.5 ${selectedPhase === phase ? "action-button--primary" : ""}`}>
        {t(phase ? `eventWorkflow.phase.${phase}` : "eventWorkflow.allPhases")}
      </Link>)}
    </nav>
    {events.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted">
      <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("common.loading")}
    </div> : events.isError ? <Alert role="alert" type="error" showIcon className="mt-6"
      title={t("eventWorkflow.loadError")}
      action={<Button onClick={() => void events.refetch()} loading={events.isFetching}>{t("common.retry")}</Button>} />
      : visibleEvents.length === 0 ? <p role="status" className="mt-8 rounded-xl border border-line bg-white p-6 text-sm text-muted">
        {t(selectedPhase ? "eventWorkflow.emptyPhase" : "eventWorkflow.empty")}
      </p> : <ul className="mt-6 space-y-4">
        {visibleEvents.map((event) => <li key={event.id}
          className="rounded-xl border border-line bg-white p-5">
          <Link to={`/organizer/events/${event.id}/preview`} state={{ eventsSearch }}
            className="flex flex-wrap items-center justify-between gap-4 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-lg font-semibold">{event.title}</h2>
              <p className="mt-2 text-xs text-muted">{new Intl.DateTimeFormat(locale, {
                dateStyle: "long", timeStyle: "short", timeZone: event.timezone,
              }).format(new Date(event.starts_at))} · {event.timezone}</p>
            </div>
            <EventStatusBadge status={event.status} phase={event.phase} />
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary-hover">
              {t("eventWorkflow.preview")}<ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
          {(event.status === "draft" || event.status === "published") && <Link to={`/organizer/events/${event.id}/edit`}
            className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary-hover hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {t("eventWorkflow.editDetails")}
          </Link>}
        </li>)}
      </ul>}
  </OrganizerWorkspace>;
};
