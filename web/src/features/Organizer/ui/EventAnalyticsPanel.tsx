import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ticketTypesApi } from "../../../shared/api/eventManagement";
import { eventReportsApi } from "../../../shared/api/eventReports";
import type { AnalyticsFilters } from "../../../shared/api/eventReports";
import { analyticsFilters, eventAnalyticsKey } from "../model/eventAnalyticsModel";
import { organizerEventKeys } from "../model/useEventLifecycle";
import { EventAnalyticsResults } from "./EventAnalyticsResults";
import { eventInputClass } from "./EventFormField";
import { ReportError, ReportLoading, ReportRefresh } from "./ReportControls";

type FilterError = NonNullable<ReturnType<typeof analyticsFilters>["error"]>;

export const EventAnalyticsPanel = ({ eventId, userId, timeZone }: { eventId: number; userId: number; timeZone: string }) => {
  const { t } = useTranslation();
  const id = useId();
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [filterError, setFilterError] = useState<FilterError>();
  const types = useQuery({
    queryKey: organizerEventKeys.ticketTypes(eventId),
    queryFn: ({ signal }) => ticketTypesApi.list(eventId, signal),
    retry: false,
  });
  const report = useQuery({
    queryKey: eventAnalyticsKey(userId, eventId, filters),
    queryFn: ({ signal }) => eventReportsApi.analytics(eventId, filters, signal),
    retry: false,
  });

  return <div className="mt-5 space-y-5">
    <form className="space-y-4 rounded-xl border border-[#D0D5DD] bg-white p-4 sm:p-5"
      onReset={() => { setFilters({}); setFilterError(undefined); }} onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const parsed = analyticsFilters(String(fields.get("since") ?? ""), String(fields.get("until") ?? ""),
        String(fields.get("ticketType") ?? ""), timeZone);
      setFilterError(parsed.error);
      if (parsed.filters) setFilters(parsed.filters);
    }}>
      <p id={`${id}-zone`} className="text-sm text-[#475467]">{t("analytics.timeZone", { zone: timeZone })}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(["since", "until"] as const).map((key) => <label key={key} className="min-w-0 text-sm font-semibold">
          {t(`reports.${key}`)}
          <input type="datetime-local" name={key} step={60} className={`mt-1.5 ${eventInputClass}`}
            aria-invalid={Boolean(filterError)} aria-describedby={`${id}-zone${filterError ? ` ${id}-error` : ""}`}
            onInput={() => setFilterError(undefined)} />
        </label>)}
        <label className="min-w-0 text-sm font-semibold">
          {t("reports.ticketType")}
          <select name="ticketType" className={`mt-1.5 ${eventInputClass}`} defaultValue="" disabled={!types.data}>
            <option value="">{t("campaigns.allTypes")}</option>
            {types.data?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
      </div>
      {filterError && <p id={`${id}-error`} role="alert" className="text-sm text-[#A93216]">{t(filterError)}</p>}
      {types.isError && <Alert role="alert" type="warning" showIcon title={t("campaigns.typesLoadError")}
        action={<Button size="small" onClick={() => void types.refetch()} loading={types.isFetching}>{t("common.retry")}</Button>} />}
      <div className="flex flex-wrap gap-2">
        <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
        <Button htmlType="reset">{t("reports.clearFilters")}</Button>
        <div className="sm:ml-auto"><ReportRefresh refresh={() => void report.refetch()} fetching={report.isFetching} /></div>
      </div>
    </form>
    <div aria-busy={report.isFetching} className="min-w-0">
      {report.isPending ? <ReportLoading /> : report.isError
        ? <ReportError error={report.error} retry={() => void report.refetch()} fetching={report.isFetching} />
        : <EventAnalyticsResults report={report.data} filteredByType={filters.ticketTypeId !== undefined} />}
    </div>
  </div>;
};
