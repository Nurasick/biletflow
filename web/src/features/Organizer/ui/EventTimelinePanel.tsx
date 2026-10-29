import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select } from "antd";
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { eventReportsApi } from "../../../shared/api/eventReports";
import type { TimelineFilters } from "../../../shared/api/eventReports";
import { EVENT_AUDIT_ACTIONS, eventReportKeys, REPORT_PAGE_SIZE, reportPage, timelineFilters } from "../model/eventReportModel";
import { ReportError, ReportLoading, ReportPagination, ReportRefresh } from "./ReportControls";

export const EventTimelinePanel = ({ eventId, userId }: { eventId: number; userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(0);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [filters, setFilters] = useState<TimelineFilters>({ actions: [] });
  const [filterError, setFilterError] = useState<"invalidDate" | "invalidRange" | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: timezone });
  const actionOptions = EVENT_AUDIT_ACTIONS.map((action) => ({ value: action, label: t(`reports.action.${action}`) }));
  const timeline = useQuery({
    queryKey: eventReportKeys.timeline(userId, eventId, filters, page),
    queryFn: ({ signal }) => eventReportsApi.timeline(eventId, filters, { ...reportPage(page), signal }),
    retry: false,
  });
  const clearFilters = () => {
    setSince(""); setUntil(""); setActions([]); setFilterError(null); setPage(0); setFilters({ actions: [] });
  };
  return <section id="event-timeline" aria-labelledby="event-timeline-title"
    className="scroll-mt-6 rounded-xl border border-[#D0D5DD] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="event-timeline-title" className="flex items-center gap-2 font-semibold">
        <History size={18} aria-hidden="true" />{t("reports.timelineTitle")}
      </h2>
      <ReportRefresh refresh={() => void timeline.refetch()} fetching={timeline.isFetching} />
    </div>
    <p className="mt-2 text-sm leading-6 text-[#667085]">{t("reports.timelineDescription")}</p>
    <p id="timeline-timezone" className="mt-1 text-xs leading-5 text-[#667085]">{t("reports.timezone", { timezone })}</p>
    <form className="my-5 space-y-4" onSubmit={(event) => {
      event.preventDefault();
      const result = timelineFilters(since, until, actions);
      if (result.error) { setFilterError(result.error); return; }
      setFilterError(null); setPage(0); setFilters(result.filters);
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium" htmlFor="timeline-since">{t("reports.since")}
          <input id="timeline-since" type="datetime-local" step={60} value={since} min="1000-01-01T00:00" max="9999-12-31T23:59"
            aria-describedby="timeline-timezone timeline-filter-error" aria-invalid={filterError !== null}
            onChange={(event) => { setSince(event.target.value); setFilterError(null); }}
            className="mt-2 block min-h-11 w-full min-w-0 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#FF5C35]" />
        </label>
        <label className="min-w-0 text-sm font-medium" htmlFor="timeline-until">{t("reports.until")}
          <input id="timeline-until" type="datetime-local" step={60} value={until} min="1000-01-01T00:00" max="9999-12-31T23:59"
            aria-describedby="timeline-timezone timeline-filter-error" aria-invalid={filterError !== null}
            onChange={(event) => { setUntil(event.target.value); setFilterError(null); }}
            className="mt-2 block min-h-11 w-full min-w-0 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#FF5C35]" />
        </label>
      </div>
      <div>
        <label htmlFor="timeline-actions" className="mb-2 block text-sm font-medium">{t("reports.actions")}</label>
        <Select id="timeline-actions" mode="multiple" allowClear value={actions} onChange={setActions}
          options={actionOptions} optionFilterProp="label" placeholder={t("reports.allActions")} className="w-full" />
      </div>
      <div id="timeline-filter-error">{filterError && <Alert role="alert" type="error" showIcon title={t(`reports.${filterError}`)} />}</div>
      <div className="flex flex-wrap gap-3">
        <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
        <Button htmlType="button" onClick={clearFilters}>{t("reports.clearFilters")}</Button>
      </div>
    </form>
    <div aria-busy={timeline.isFetching}>
      {timeline.isPending ? <ReportLoading /> : timeline.isError
        ? <ReportError error={timeline.error} retry={() => void timeline.refetch()} fetching={timeline.isFetching} />
        : timeline.data.length === 0 ? <p role="status" className="py-4 text-sm text-[#667085]">{t("reports.timelineEmpty")}</p>
          : <ol className="divide-y divide-[#EAECF0]">
            {timeline.data.slice(0, REPORT_PAGE_SIZE).map((entry) => <li key={entry.id} className="py-4 first:pt-0">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-[#667085]">
                <time dateTime={entry.created_at}>{dateFormat.format(new Date(entry.created_at))}</time>
                <span>{entry.actor_user_id === null ? t("reports.system") : t("reports.actor", { id: entry.actor_user_id })}</span>
              </div>
              <h3 className="mt-2 break-words text-sm font-semibold">{actionOptions.find((option) => option.value === entry.action)?.label ?? entry.action}</h3>
              <p className="mt-1 break-words text-sm">{entry.summary}</p>
              <p className="mt-1 break-words font-mono text-xs text-[#667085]">{entry.action} · {t("reports.entity", { type: entry.entity_type, id: entry.entity_id })}</p>
              {entry.payload && Object.keys(entry.payload).length > 0 && <details className="mt-2 text-xs text-[#475467]">
                <summary className="cursor-pointer py-1">{t("reports.details")}</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#F5F5F0] p-3">{JSON.stringify(entry.payload, null, 2)}</pre>
              </details>}
            </li>)}
          </ol>}
    </div>
    <ReportPagination page={page} onPage={setPage} label={t("reports.timelineTitle")} fetching={timeline.isFetching}
      hasNext={!timeline.isError && Boolean(timeline.data && timeline.data.length > REPORT_PAGE_SIZE)} />
  </section>;
};
