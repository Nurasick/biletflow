import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { eventReportsApi } from "../../../shared/api/eventReports";
import type { OrganizerAnalyticsFilters } from "../../../shared/api/eventReports";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { analyticsFilters } from "../model/eventAnalyticsModel";
import { AnalyticsTable, analyticsCard, Metrics } from "./EventAnalyticsResults";
import { eventInputClass } from "./EventFormField";
import { ReportError, ReportLoading, ReportRefresh } from "./ReportControls";

type FilterError = NonNullable<ReturnType<typeof analyticsFilters>["error"]>;

// §4.15 across every event of the organizer. Events have their own zones, so
// the date range is read in the organizer's own (browser) zone here.
export const OrganizerAnalyticsOverview = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [filters, setFilters] = useState<OrganizerAnalyticsFilters>({});
  const [filterError, setFilterError] = useState<FilterError>();
  const report = useQuery({
    queryKey: ["organizer", "analytics-overview", userId, filters],
    queryFn: ({ signal }) => eventReportsApi.overview(filters, signal),
    retry: false,
  });
  const count = new Intl.NumberFormat(locale).format;
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format;
  const money = (minor: number) => formatMinor(minor, locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const startDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return <div className="mt-5 space-y-5">
    <form className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5"
      onReset={() => { setFilters({}); setFilterError(undefined); }} onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const parsed = analyticsFilters(String(fields.get("since") ?? ""), String(fields.get("until") ?? ""), "", timeZone);
        setFilterError(parsed.error);
        if (parsed.filters) setFilters({ since: parsed.filters.since, until: parsed.filters.until });
      }}>
      <p id={`${id}-zone`} className="text-sm text-muted-strong">{t("analytics.overviewTimeZone", { zone: timeZone })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["since", "until"] as const).map((key) => <label key={key} className="min-w-0 text-sm font-semibold">
          {t(`reports.${key}`)}
          <input type="datetime-local" name={key} step={60} className={`mt-1.5 ${eventInputClass}`}
            aria-invalid={Boolean(filterError)} aria-describedby={`${id}-zone${filterError ? ` ${id}-error` : ""}`}
            onInput={() => setFilterError(undefined)} />
        </label>)}
      </div>
      {filterError && <p id={`${id}-error`} role="alert" className="text-sm text-primary-hover">{t(filterError)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
        <Button htmlType="reset">{t("reports.clearFilters")}</Button>
        <div className="sm:ml-auto"><ReportRefresh refresh={() => void report.refetch()} fetching={report.isFetching} /></div>
      </div>
    </form>
    <div aria-busy={report.isFetching} className="min-w-0">
      {report.isPending ? <ReportLoading /> : report.isError
        ? <ReportError error={report.error} retry={() => void report.refetch()} fetching={report.isFetching} />
        : <div className="space-y-5">
          <section className={analyticsCard} aria-labelledby="overview-totals">
            <h2 id="overview-totals" className="font-semibold">{t("analytics.overviewTotals", { count: report.data.event_count })}</h2>
            <Metrics wide entries={[
              [t("sales.gross"), money(report.data.gross_minor)],
              [t("promo.discount"), money(report.data.discounts_minor)],
              [t("campaigns.refunds"), money(report.data.refunds_minor)],
              [t("campaigns.net"), money(report.data.net_minor)],
              [t("sales.fees"), money(report.data.fees_minor)],
              [t("sales.payout"), money(report.data.estimated_payout_minor)],
              [t("sales.sold"), count(report.data.tickets_sold)],
              [t("analytics.soldPercent"), percent(report.data.percent_sold / 100)],
            ]} />
            {report.data.is_simulated && <p className="mt-3 text-xs text-muted">{t("analytics.simulated")}</p>}
          </section>
          <section className={analyticsCard} aria-labelledby="overview-events">
            <h2 id="overview-events" className="font-semibold">{t("analytics.byEvent")}</h2>
            <AnalyticsTable label={t("analytics.byEvent")} empty={t("analytics.noEvents")}
              headers={[t("analytics.event"), t("analytics.eventStarts"), t("sales.sold"), t("analytics.unsoldCapacity"),
                t("sales.gross"), t("campaigns.net"), t("sales.payout"), t("ops.checkedIn")]}
              rows={report.data.events.map((event) => ({
                key: event.event_id,
                title: <Link to={`/organizer/events/${event.event_id}/analytics`} className="text-primary-hover hover:underline">{event.title}</Link>,
                cells: [startDate.format(new Date(event.starts_at)), count(event.tickets_sold), count(event.tickets_remaining),
                  money(event.gross_minor), money(event.net_minor), money(event.estimated_payout_minor),
                  `${count(event.attendance.checked_in)} / ${count(event.attendance.registered)}`],
              }))} />
          </section>
          <section className={analyticsCard} aria-labelledby="overview-daily">
            <h2 id="overview-daily" className="font-semibold">{t("analytics.dailySales")}</h2>
            <AnalyticsTable label={t("analytics.dailySales")} empty={t("analytics.noSales")}
              headers={[t("analytics.day"), t("sales.sold"), t("analytics.afterDiscounts")]}
              rows={report.data.sales_over_time.map((point) => ({
                key: point.date,
                title: <time dateTime={point.date}>{day.format(new Date(`${point.date}T00:00:00Z`))}</time>,
                cells: [count(point.tickets), money(point.revenue_minor)],
              }))} />
          </section>
        </div>}
    </div>
  </div>;
};
