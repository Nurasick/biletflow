import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { adminApi } from "../../../shared/api/admin";
import { adminTimelineRange, operationsKeys } from "../model/operationsModel";
import type { AdminTimelineRange } from "../model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, RefreshButton, operationsCard } from "./OperationsWorkspace";

const PAGE_SIZE = 25;
const dateInput = "mt-1.5 block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

export const AdminTimeline = ({ eventId, userId, timeZone }: { eventId: number; userId?: number; timeZone: string }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const [page, setPage] = useState(0);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [range, setRange] = useState<AdminTimelineRange>({});
  const [error, setError] = useState<"invalidDate" | "invalidRange" | null>(null);
  const timeline = useQuery({
    queryKey: operationsKeys.timeline(userId, eventId, page, range),
    queryFn: ({ signal }) => adminApi.timeline(eventId, PAGE_SIZE + 1, page * PAGE_SIZE, signal, range),
    enabled: Boolean(userId), retry: false,
  });
  const apply = (nextSince: string, nextUntil: string) => {
    const result = adminTimelineRange(nextSince, nextUntil, timeZone);
    if (result.error) { setError(result.error); return; }
    setError(null);
    setPage(0);
    setRange(result.range);
  };
  const errorId = `${id}-error`;

  return <section className={operationsCard} aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={`${id}-title`} className="text-xl font-bold">{t("ops.timeline")}</h2>
      <RefreshButton refresh={() => void timeline.refetch()} fetching={timeline.isFetching} /></div>
    <form className="mt-4 rounded-lg border border-line-soft p-3" onSubmit={(event) => { event.preventDefault(); apply(since, until); }}>
      <fieldset>
        <legend className="text-sm font-semibold">{t("ops.timelineRange")}</legend>
        <p className="mt-1 text-xs text-muted">{t("ops.timelineRangeHint", { timeZone })}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm" htmlFor={`${id}-since`}>{t("reports.since")}</label>
            <input id={`${id}-since`} type="datetime-local" step={60} value={since} className={dateInput}
              aria-invalid={error !== null} aria-describedby={error ? errorId : undefined}
              onChange={(event) => { setSince(event.target.value); setError(null); }} />
          </div>
          <div>
            <label className="text-sm" htmlFor={`${id}-until`}>{t("reports.until")}</label>
            <input id={`${id}-until`} type="datetime-local" step={60} value={until} className={dateInput}
              aria-invalid={error !== null} aria-describedby={error ? errorId : undefined}
              onChange={(event) => { setUntil(event.target.value); setError(null); }} />
          </div>
        </div>
        {error && <p id={errorId} role="alert" className="mt-2 text-sm text-primary-hover">{t(`reports.${error}`)}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
          <Button disabled={!since && !until && !range.since && !range.until}
            onClick={() => { setSince(""); setUntil(""); apply("", ""); }}>{t("reports.clearFilters")}</Button>
        </div>
      </fieldset>
    </form>
    <div className="mt-4" aria-busy={timeline.isFetching}>{timeline.isPending ? <OperationsLoading /> : timeline.isError ? <OperationsError error={timeline.error} retry={() => void timeline.refetch()} />
      : timeline.data.length === 0 ? <p role="status" className="text-sm text-muted">{t("ops.timelineEmpty")}</p>
        : <ol className="divide-y divide-line-soft">
          {timeline.data.slice(0, PAGE_SIZE).map((entry) => <li key={entry.id} className="py-4 first:pt-0">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><time dateTime={entry.created_at}>{new Intl.DateTimeFormat(locale, {
              dateStyle: "medium", timeStyle: "medium", timeZone,
            }).format(new Date(entry.created_at))}</time><span>{entry.actor_user_id === null ? t("ops.system")
              : entry.actor_name ?? t("ops.actor", { id: entry.actor_user_id })}</span></div>
            <p className="mt-2 break-words text-sm font-semibold">{entry.summary}</p>
            <p className="mt-1 break-words font-mono text-xs text-muted">{entry.action} · {t("ops.entity", { type: entry.entity_type, id: entry.entity_id })}</p>
            {entry.payload && Object.keys(entry.payload).length > 0 && <details className="mt-2 text-xs text-muted-strong">
              <summary className="cursor-pointer py-1">{t("ops.timelinePayload")}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3">{JSON.stringify(entry.payload, null, 2)}</pre>
            </details>}
          </li>)}
        </ol>}</div>
    <OperationsPagination page={page} next={Boolean(timeline.data && timeline.data.length > PAGE_SIZE)} busy={timeline.isFetching || timeline.isError} onPage={setPage} />
  </section>;
};
