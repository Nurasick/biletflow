import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import { operationsKeys, validEventId } from "../features/Operations/model/operationsModel";
import { AdminActivation } from "../features/Operations/ui/AdminActivation";
import { AdminModeration } from "../features/Operations/ui/AdminModeration";
import { AdminTimeline } from "../features/Operations/ui/AdminTimeline";
import { OperationsError, OperationsLoading, OperationsStatus, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi } from "../shared/api/admin";
import { ApiError } from "../shared/api/auth";

const visibilityLabels = { public: "ops.public", unlisted: "ops.unlisted", private: "ops.private" } as const;

const AdminEventContent = ({ eventId }: { eventId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const event = useQuery({
    queryKey: operationsKeys.adminEvent(me.data?.id, eventId),
    queryFn: ({ signal }) => adminApi.event(eventId, params.get("slug")?.slice(0, 100), signal),
    enabled: Boolean(me.data?.is_platform_admin), retry: false,
  });
  const activation = useQuery({
    queryKey: operationsKeys.activation(me.data?.id, eventId),
    queryFn: ({ signal }) => adminApi.activation(eventId, signal),
    enabled: Boolean(me.data?.is_platform_admin) && event.isSuccess, retry: false,
  });
  if (event.isPending) return <OperationsLoading />;
  if (event.isError) return <OperationsError error={event.error} retry={() => void event.refetch()} />;
  const record = event.data;
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: record.timezone });
  const ready = Boolean(me.data?.is_platform_admin && event.isSuccess && !event.isFetching);
  const refresh = () => { void event.refetch(); void activation.refetch(); };

  return <>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#A93216]">{t("ops.eventId", { id: eventId })}</p>
        <h1 className="break-words text-3xl font-bold tracking-tight">{record.title}</h1><p className="mt-2 break-all font-mono text-xs text-[#667085]">{record.slug}</p></div>
      <div className="flex flex-wrap items-center gap-3"><OperationsStatus status={record.status} />
        <RefreshButton refresh={refresh} fetching={event.isFetching || activation.isFetching} /></div>
    </div>
    <div className="space-y-6">
      <AdminModeration key={`${me.data?.id}:${eventId}`} eventId={eventId} userId={me.data?.id} status={record.status}
        activationStatus={activation.data?.status} ready={ready} activationReady={activation.isSuccess && !activation.isFetching} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className={operationsCard}>
          <h2 className="text-xl font-bold">{t("ops.eventDetails")}</h2>
          <p className="mt-2 text-xs text-[#667085]">{t("ops.organizerProfile", { id: record.organizer_profile_id })}</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="text-[#667085]">{t("ops.venue")}</dt><dd className="mt-1 break-words font-semibold">{record.venue_name}<span className="mt-1 block font-normal">{record.venue_address}</span></dd></div>
            <div><dt className="text-[#667085]">{t("ops.schedule")}</dt><dd className="mt-1">{dates.format(new Date(record.starts_at))} – {dates.format(new Date(record.ends_at))}<span className="mt-1 block text-xs text-[#667085]">{record.timezone}</span></dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#667085]">{t("ops.visibility")}</dt><dd>{t(visibilityLabels[record.visibility])}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#667085]">{t("ops.capacity")}</dt><dd>{record.capacity === null ? t("ops.unlimited") : new Intl.NumberFormat(locale).format(record.capacity)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#667085]">{t("ops.created")}</dt><dd>{dates.format(new Date(record.created_at))}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#667085]">{t("ops.updated")}</dt><dd>{dates.format(new Date(record.updated_at))}</dd></div>
            <div><dt className="text-[#667085]">{t("ops.description")}</dt><dd className="mt-2 whitespace-pre-wrap break-words leading-6">{record.description || t("ops.noDescription")}</dd></div>
          </dl>
        </section>
        {activation.isPending ? <div className={operationsCard}><OperationsLoading /></div> : activation.isError
          ? <section className={operationsCard}><h2 className="mb-4 text-xl font-bold">{t("ops.activation")}</h2><OperationsError error={activation.error} retry={() => void activation.refetch()} /></section>
          : <AdminActivation activation={activation.data} timeZone={record.timezone} />}
      </div>
      <AdminTimeline key={`${me.data?.id}:${eventId}`} eventId={eventId} userId={me.data?.id} timeZone={record.timezone} />
    </div>
  </>;
};

export const AdminEventPage = () => {
  const { eventId: routeId } = useParams();
  const eventId = validEventId(routeId);
  return <OperationsWorkspace admin detail>{eventId ? <AdminEventContent key={eventId} eventId={eventId} /> : <OperationsError error={new ApiError("Invalid event ID", 404)} />}</OperationsWorkspace>;
};
