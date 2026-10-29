import { useQuery } from "@tanstack/react-query";
import { Progress } from "antd";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { operationsKeys, validEventId } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsStatus, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { StaffCheckIn } from "../features/Operations/ui/StaffCheckIn";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { ApiError } from "../shared/api/auth";
import { checkInApi } from "../shared/api/staff";

const StaffEventContent = ({ eventId }: { eventId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const events = useQuery({
    queryKey: operationsKeys.staffEvents(me.data?.id), queryFn: ({ signal }) => checkInApi.events(signal),
    enabled: Boolean(me.data), retry: false,
  });
  const attendance = useQuery({
    queryKey: operationsKeys.attendance(me.data?.id, eventId),
    queryFn: ({ signal }) => checkInApi.attendance(eventId, signal), enabled: Boolean(me.data),
    retry: false, refetchInterval: 15_000, refetchIntervalInBackground: false,
  });
  const event = events.data?.find((event) => event.id === eventId);
  // Keep the camera available during successful background count refreshes;
  // a failed or denied read still closes the operational controls.
  const ready = Boolean(me.data && event && events.isSuccess && attendance.isSuccess);
  const refresh = () => { void events.refetch(); void attendance.refetch(); };
  const dates = event ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: event.timezone }) : null;

  return <>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#A93216]">{t("ops.staffWorkspace")}</p>
        <h1 className="break-words text-3xl font-bold tracking-tight">{event?.title ?? t("ops.eventId", { id: eventId })}</h1>
        {event && <p className="mt-3 text-sm leading-6 text-[#667085]">{event.venue_name} · {dates?.format(new Date(event.starts_at))} · {event.timezone}</p>}
      </div><div className="flex flex-wrap items-center gap-3">{event && <OperationsStatus status={event.status} />}
        <RefreshButton refresh={refresh} fetching={attendance.isFetching || events.isFetching} /></div>
    </div>
    <section className={`${operationsCard} mb-6`}>
      <h2 className="text-xl font-bold">{t("ops.attendance")}</h2>
      <p className="mt-2 text-xs leading-5 text-[#667085]">{t("ops.liveHint")}</p>
      {attendance.isPending || events.isPending ? <OperationsLoading />
        : attendance.isError ? <div className="mt-4"><OperationsError error={attendance.error} retry={refresh} /></div>
          : events.isError ? <div className="mt-4"><OperationsError error={events.error} retry={refresh} /></div>
            : !event ? <div className="mt-4"><OperationsError error={new ApiError("Event is not assigned", 403)} retry={refresh} /></div>
              : <>
                <dl className="mt-5 grid grid-cols-3 gap-3 sm:gap-6">
                  {([['ops.registered', attendance.data.registered], ['ops.checkedIn', attendance.data.checked_in], ['ops.absent', attendance.data.absent]] as const).map(([label, value]) => <div key={label}>
                    <dt className="text-xs text-[#667085] sm:text-sm">{t(label)}</dt><dd className="mt-2 text-2xl font-bold sm:text-4xl">{new Intl.NumberFormat(locale).format(value)}</dd>
                  </div>)}
                </dl>
                <div className="mt-4"><Progress percent={attendance.data.checked_in_percent} showInfo={false} strokeColor="#FF5C35" aria-label={t("ops.percent", { percent: attendance.data.checked_in_percent })} />
                  <p className="text-xs text-[#667085]">{t("ops.percent", { percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(attendance.data.checked_in_percent) })}
                    {attendance.dataUpdatedAt > 0 && <> · {t("ops.lastUpdated", { time: new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(attendance.dataUpdatedAt) })}</>}</p></div>
              </>}
    </section>
    <StaffCheckIn key={`${me.data?.id}:${eventId}`} userId={me.data?.id} eventId={eventId} ready={ready} />
  </>;
};

export const StaffEventPage = () => {
  const { eventId: routeId } = useParams();
  const eventId = validEventId(routeId);
  return <OperationsWorkspace detail>{eventId ? <StaffEventContent key={eventId} eventId={eventId} /> : <OperationsError error={new ApiError("Invalid event ID", 404)} />}</OperationsWorkspace>;
};
