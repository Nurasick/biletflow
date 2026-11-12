import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi } from "../shared/api/admin";
import { formatMinor } from "../shared/lib/formatPrice";

const groups = [
  {
    title: "adminOverview.accountsAndEvents",
    metrics: [
      { field: "users", label: "adminOverview.accounts", to: "/admin/users" },
      { field: "organizers", label: "adminOverview.organizers" },
      { field: "events_published", label: "adminOverview.published" },
      { field: "events_suspended", label: "adminOverview.suspended" },
    ],
  },
  {
    title: "adminOverview.sales",
    metrics: [
      { field: "orders_confirmed", label: "adminOverview.orders", to: "/admin/transactions?status=confirmed" },
      { field: "tickets_issued", label: "adminOverview.tickets" },
      { field: "gross_minor", label: "adminOverview.gross", to: "/admin/transactions?view=payments" },
      { field: "refunds_minor", label: "adminOverview.refunds" },
    ],
  },
  {
    title: "adminOverview.review",
    metrics: [
      { field: "open_reports", label: "adminOverview.openReports", to: "/admin/reports" },
      { field: "open_support_cases", label: "adminOverview.openSupport" },
      { field: "payments_failed", label: "adminOverview.failedPayments", to: "/admin/transactions?view=payments&status=failed" },
    ],
  },
] as const;

export const AdminOverviewPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const overview = useQuery({
    queryKey: operationsKeys.adminOverview(me.data?.id),
    queryFn: ({ signal }) => adminApi.overview(signal),
    enabled: Boolean(me.data?.is_platform_admin),
    retry: false,
  });
  const number = new Intl.NumberFormat(locale);

  return <OperationsWorkspace admin>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{t("adminOverview.title")}</h1>
      <RefreshButton refresh={() => void overview.refetch()} fetching={overview.isFetching} />
    </div>
    {overview.isPending ? <OperationsLoading /> : overview.isError
      ? <OperationsError error={overview.error} retry={() => void overview.refetch()} />
      : <div className="space-y-5">
        {groups.map(({ title, metrics }) => <section key={title} className={operationsCard} aria-labelledby={title}>
          <h2 id={title} className="text-lg font-bold">{t(title)}</h2>
          {title === "adminOverview.sales" && overview.data.is_simulated && (
            <p className="mt-1 text-sm text-[#667085]">{t("analytics.simulated")}</p>
          )}
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => {
              const { field, label } = metric;
              const value = overview.data[field];
              return <div key={field} className="rounded-lg bg-[#F5F5F0] px-4 py-3">
                <dt className="text-sm text-[#475467]">
                  {"to" in metric
                    ? <Link to={metric.to} className="font-semibold text-[#A93216] underline underline-offset-2">{t(label)}</Link>
                    : t(label)}
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {field === "gross_minor" || field === "refunds_minor" ? formatMinor(value, locale) : number.format(value)}
                </dd>
              </div>;
            })}
          </dl>
        </section>)}
      </div>}
  </OperationsWorkspace>;
};
