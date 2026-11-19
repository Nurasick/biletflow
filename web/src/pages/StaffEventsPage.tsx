import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsStatus, OperationsWorkspace, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { checkInApi } from "../shared/api/staff";

export const StaffEventsPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const events = useQuery({
    queryKey: operationsKeys.staffEvents(me.data?.id),
    queryFn: ({ signal }) => checkInApi.events(signal),
    enabled: Boolean(me.data), retry: false,
  });
  return <OperationsWorkspace>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="page-title">{t("ops.assignedEvents")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{t("ops.assignedDescription")}</p></div>
      <RefreshButton refresh={() => void events.refetch()} fetching={events.isFetching} />
    </div>
    <div className="mt-6">
      {events.isPending ? <OperationsLoading /> : events.isError ? <OperationsError error={events.error} retry={() => void events.refetch()} />
        : events.data.length === 0 ? <p className="panel p-8 text-sm text-muted">{t("ops.noAssigned")}</p>
          : <ul className="grid gap-4 sm:grid-cols-2">
            {events.data.map((event) => <li key={event.id}>
              <Link to={`/staff/events/${event.id}`} className="flex h-full flex-col gap-4 panel p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                <div className="flex flex-wrap items-center justify-between gap-2"><OperationsStatus status={event.status} />
                  <span className="text-xs text-muted">{t(event.role === "organizer" ? "ops.organizer" : "ops.eventAdmin")}</span></div>
                <h2 className="break-words text-xl font-semibold">{event.title}</h2>
                <p className="text-sm text-muted">{event.venue_name}<br />{new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium", timeStyle: "short", timeZone: event.timezone,
                }).format(new Date(event.starts_at))} · {event.timezone}</p>
                <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary-hover">{t("ops.openCheckIn")}<ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
            </li>)}
          </ul>}
    </div>
  </OperationsWorkspace>;
};
