import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import type { EventAnalytics } from "../../../shared/api/eventReports";
import { formatMinor } from "../../../shared/lib/formatPrice";

const card = "min-w-0 rounded-xl border border-[#D0D5DD] bg-white p-4 sm:p-5";

export const EventAnalyticsResults = ({ report, filteredByType }: { report: EventAnalytics; filteredByType: boolean }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const count = new Intl.NumberFormat(locale).format;
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format;
  const money = (minor: number) => formatMinor(minor, locale);
  // The API's day label already uses the event time zone.
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const peak = report.sales_over_time.reduce((max, point) => Math.max(max, point.tickets), 1);
  const { attendance } = report;

  return <div className="space-y-5">
    <section className={card} aria-labelledby="analytics-revenue">
      <h2 id="analytics-revenue" className="font-semibold">{t("analytics.salesTotals")}</h2>
      <Metrics wide entries={[
        [t("sales.gross"), money(report.gross_minor)],
        [t("promo.discount"), money(report.discounts_minor)],
        [t("campaigns.refunds"), money(report.refunds_minor)],
        [t("campaigns.net"), money(report.net_minor)],
      ]} />
      {report.is_simulated && <p className="mt-3 text-xs text-[#667085]">{t("analytics.simulated")}</p>}
      {filteredByType && report.refunds_minor > 0 && <p className="mt-2 text-xs text-[#667085]">{t("analytics.refundScope")}</p>}
    </section>
    <section className={card} aria-labelledby="analytics-daily-sales">
      <h2 id="analytics-daily-sales" className="font-semibold">{t("analytics.dailySales")}</h2>
      <AnalyticsTable label={t("analytics.dailySales")} headers={[t("analytics.day"), t("sales.sold"), t("analytics.afterDiscounts")]}
        empty={t("analytics.noSales")} rows={report.sales_over_time.map((point) => ({
          key: point.date,
          title: <time dateTime={point.date}>{date.format(new Date(`${point.date}T00:00:00Z`))}</time>,
          cells: [
            <div key="volume" className="flex min-w-24 items-center gap-3">
              <div aria-hidden="true" className="h-1.5 min-w-12 flex-1 rounded-full bg-[#F2F4F7]">
                <div className="h-full rounded-full bg-[#D9431F]" style={{ width: `${(point.tickets / peak) * 100}%` }} />
              </div>
              <span className="tabular-nums">{count(point.tickets)}</span>
            </div>,
            money(point.revenue_minor),
          ],
        }))} />
    </section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={card} aria-labelledby="analytics-inventory">
        <h2 id="analytics-inventory" className="font-semibold">{t("analytics.currentInventory")}</h2>
        <Metrics entries={[
          [t("analytics.capacity"), count(report.capacity)],
          [t("sales.sold"), count(report.tickets_sold)],
          [t("analytics.unsoldCapacity"), count(report.tickets_remaining)],
          [t("analytics.soldPercent"), percent(report.percent_sold / 100)],
        ]} />
      </section>
      <section className={card} aria-labelledby="analytics-attendance">
        <h2 id="analytics-attendance" className="font-semibold">{t("analytics.currentAttendance")}</h2>
        <Metrics entries={[
          [t("ops.registered"), count(attendance.registered)],
          [t("ops.checkedIn"), count(attendance.checked_in)],
          [t("ops.absent"), count(attendance.absent)],
          [t("analytics.checkInRate"), percent(attendance.checked_in_percent / 100)],
        ]} />
      </section>
    </div>
    <section className={card} aria-labelledby="analytics-ticket-types">
      <h2 id="analytics-ticket-types" className="font-semibold">{t("analytics.salesByType")}</h2>
      <AnalyticsTable label={t("analytics.salesByType")} empty={t("eventWorkflow.noTickets")}
        headers={[t("reports.ticketType"), t("analytics.soldInRange"), t("analytics.afterDiscounts"),
          t("analytics.soldNow"), t("analytics.heldNow"), t("analytics.typeQuantity")]}
        rows={report.by_ticket_type.map((type) => ({
          key: type.ticket_type_id,
          title: type.name,
          cells: [count(type.tickets_in_range), money(type.revenue_minor), count(type.quantity_sold),
            count(type.quantity_reserved), count(type.quantity_total)],
        }))} />
    </section>
    <section className={card} aria-labelledby="analytics-campaigns">
      <h2 id="analytics-campaigns" className="font-semibold">{t("analytics.campaignResults")}</h2>
      {report.campaigns.length > 0 && <p className="mt-2 text-xs text-[#667085]">{t("analytics.campaignScope")}</p>}
      <AnalyticsTable label={t("analytics.campaignResults")} empty={t("campaigns.empty")}
        headers={[t("campaigns.name"), t("campaigns.redemptions"), t("campaigns.orders"), t("campaigns.tickets"),
          t("campaigns.gross"), t("promo.discount"), t("campaigns.refunds"), t("campaigns.net")]}
        rows={report.campaigns.map((campaign) => ({
          key: campaign.id,
          title: <>{campaign.name}<code className="block break-all text-xs font-normal text-[#667085]">{campaign.code}</code></>,
          cells: [count(campaign.redemptions), count(campaign.orders), count(campaign.tickets_sold),
            money(campaign.gross_minor), money(campaign.discount_minor), money(campaign.refunds_minor), money(campaign.net_minor)],
        }))} />
    </section>
  </div>;
};

const Metrics = ({ entries, wide = false }: { entries: [string, string][]; wide?: boolean }) => (
  <dl className={`mt-3 grid grid-cols-2 gap-3 ${wide ? "sm:grid-cols-4" : ""}`}>
    {entries.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-[#F5F5F0] p-3">
      <dt className="text-xs leading-5 text-[#475467]">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold tabular-nums">{value}</dd>
    </div>)}
  </dl>
);

const AnalyticsTable = ({ label, headers, rows, empty }: {
  label: string; headers: string[]; rows: { key: number | string; title: ReactNode; cells: ReactNode[] }[]; empty: string;
}) => rows.length === 0 ? <p className="mt-3 text-sm text-[#667085]">{empty}</p> : (
  <div role="region" aria-label={label} tabIndex={0}
    className="mt-3 max-h-80 overflow-auto rounded focus-visible:outline-2 focus-visible:outline-[#FF5C35]">
    <table aria-label={label} className="w-full min-w-max text-left text-sm">
      <thead className="sticky top-0 border-b border-[#D0D5DD] bg-white text-xs text-[#475467]">
        <tr>{headers.map((header) => <th key={header} scope="col" className="px-3 py-2 first:pl-1">{header}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-[#EAECF0]">
        {rows.map(({ key, title, cells }) => <tr key={key}>
          <th scope="row" className="max-w-52 break-words py-2 pl-1 pr-3 font-semibold">{title}</th>
          {cells.map((cell, index) => <td key={headers[index + 1]} className="whitespace-nowrap px-3 py-2 tabular-nums">{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
);
