import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { adminApi } from "../../../shared/api/admin";
import { operationsKeys } from "../model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, RefreshButton, operationsCard } from "./OperationsWorkspace";

const PAGE_SIZE = 25;

export const AdminTimeline = ({ eventId, userId, timeZone }: { eventId: number; userId?: number; timeZone: string }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(0);
  const timeline = useQuery({
    queryKey: operationsKeys.timeline(userId, eventId, page),
    queryFn: ({ signal }) => adminApi.timeline(eventId, PAGE_SIZE + 1, page * PAGE_SIZE, signal),
    enabled: Boolean(userId), retry: false,
  });
  return <section className={operationsCard}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{t("ops.timeline")}</h2>
      <RefreshButton refresh={() => void timeline.refetch()} fetching={timeline.isFetching} /></div>
    <div className="mt-4">{timeline.isPending ? <OperationsLoading /> : timeline.isError ? <OperationsError error={timeline.error} retry={() => void timeline.refetch()} />
      : timeline.data.length === 0 ? <p className="text-sm text-[#667085]">{t("ops.timelineEmpty")}</p>
        : <ol className="divide-y divide-[#EAECF0]">
          {timeline.data.slice(0, PAGE_SIZE).map((entry) => <li key={entry.id} className="py-4 first:pt-0">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-[#667085]"><time dateTime={entry.created_at}>{new Intl.DateTimeFormat(locale, {
              dateStyle: "medium", timeStyle: "medium", timeZone,
            }).format(new Date(entry.created_at))}</time><span>{entry.actor_user_id === null ? t("ops.system") : t("ops.actor", { id: entry.actor_user_id })}</span></div>
            <p className="mt-2 break-words text-sm font-semibold">{entry.summary}</p>
            <p className="mt-1 break-words font-mono text-xs text-[#667085]">{entry.action} · {t("ops.entity", { type: entry.entity_type, id: entry.entity_id })}</p>
            {entry.payload && Object.keys(entry.payload).length > 0 && <details className="mt-2 text-xs text-[#475467]">
              <summary className="cursor-pointer py-1">{t("ops.timelinePayload")}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#F5F5F0] p-3">{JSON.stringify(entry.payload, null, 2)}</pre>
            </details>}
          </li>)}
        </ol>}</div>
    <OperationsPagination page={page} next={Boolean(timeline.data && timeline.data.length > PAGE_SIZE)} busy={timeline.isFetching || timeline.isError} onPage={setPage} />
  </section>;
};
