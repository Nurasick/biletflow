import { Alert, Button, Tag } from "antd";
import { ArrowLeft, CalendarDays, ChartColumn, CreditCard, Flag, LayoutDashboard, LoaderCircle, RefreshCw, ScanLine, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";

import { ApiError } from "../../../shared/api/auth";

const adminLinks = [
  { to: "/admin", label: "adminOverview.title", end: true, Icon: LayoutDashboard },
  { to: "/admin/events", label: "ops.adminEvents", end: false, Icon: CalendarDays },
  { to: "/admin/users", label: "adminUsers.title", end: true, Icon: Users },
  { to: "/admin/reports", label: "eventReport.queue", end: true, Icon: Flag },
  { to: "/admin/transactions", label: "adminFinance.title", end: true, Icon: CreditCard },
  { to: "/admin/sales", label: "adminSales.title", end: true, Icon: ChartColumn },
  { to: "/admin/settings", label: "adminSettings.title", end: true, Icon: Settings },
] as const;

export const OperationsWorkspace = ({ children, admin = false, detail = false }: { children: ReactNode; admin?: boolean; detail?: boolean }) => {
  const { t } = useTranslation();
  const backLink = (
    <Link to={detail ? admin ? "/admin/events" : "/staff/events" : "/account"}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted hover:text-primary">
      <ArrowLeft size={16} aria-hidden="true" />{t(detail ? "ops.back" : "ops.account")}
    </Link>
  );

  return (
    <div className={`site-container grid min-h-[60vh] items-start gap-6 py-6 sm:py-9 ${admin ? "lg:grid-cols-[225px_minmax(0,1fr)] lg:gap-9" : ""}`}>
      {admin ? (
        <aside className="panel p-3 lg:sticky lg:top-6">
          {backLink}
          <p className="mx-2 mt-2 border-t border-line-soft pt-3 text-xs font-bold text-muted">{t("ops.adminWorkspace")}</p>
          <nav aria-label={t("ops.adminWorkspace")} className="mt-2 flex flex-wrap gap-1 lg:flex-col">
            {adminLinks.map(({ to, label, end, Icon }) => <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-semibold ${
                isActive ? "bg-accent-wash text-primary" : "text-muted-strong hover:bg-soft hover:text-ink"
              }`}><Icon size={18} className="shrink-0" aria-hidden="true" />{t(label)}</NavLink>)}
          </nav>
        </aside>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {backLink}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-3 py-2 text-xs font-bold text-primary">
            <ScanLine size={16} aria-hidden="true" />{t("ops.staffWorkspace")}
          </span>
        </div>
      )}
      <main className="min-w-0">{children}</main>
    </div>
  );
};

export const OperationsLoading = () => {
  const { t } = useTranslation();
  return <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted">
    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("ops.loading")}
  </div>;
};

export const OperationsError = ({ error, retry, saving = false }: { error: unknown; retry?: () => void; saving?: boolean }) => {
  const { t } = useTranslation();
  const key = error instanceof ApiError
    ? error.status === 401 ? "ops.sessionExpired" : error.status === 403 ? "ops.forbidden"
      : error.status === 404 ? "ops.notFound" : error.status === 409 ? "ops.conflict"
        : error.status === 422 ? "ops.invalidInput" : saving ? "ops.saveError" : "ops.loadError"
    : saving ? "ops.saveError" : "ops.loadError";
  return <Alert role="alert" type="error" showIcon title={t(key)}
    description={error instanceof ApiError && error.status === 409 ? error.message : undefined}
    action={error instanceof ApiError && error.status === 401
      ? <Link to="/login" state={{ from: window.location.pathname + window.location.search }} className="font-semibold">{t("common.signIn")}</Link>
      : retry ? <Button onClick={retry}>{t("ops.retry")}</Button> : undefined} />;
};

export const RefreshButton = ({ refresh, fetching, disabled = false }: {
  refresh: () => void; fetching: boolean; disabled?: boolean;
}) => {
  const { t } = useTranslation();
  return <Button onClick={refresh} loading={fetching} disabled={disabled} icon={<RefreshCw size={15} aria-hidden="true" />}>
    {t(fetching ? "ops.refreshing" : "ops.refresh")}
  </Button>;
};

export const OperationsStatus = ({ status }: { status: string }) => {
  const { t } = useTranslation();
  const labels = {
    draft: "ops.statusDraft", published: "ops.statusPublished", suspended: "ops.statusSuspended", cancelled: "ops.statusCancelled",
  } as const;
  const key = status as keyof typeof labels;
  return <Tag color={status === "published" ? "green" : status === "suspended" ? "orange" : status === "cancelled" ? "red" : "default"}>
    {t(labels[key] ?? "ops.statusUnknown")}
  </Tag>;
};

export const OperationsPagination = ({ page, next, busy, onPage }: { page: number; next: boolean; busy: boolean; onPage: (page: number) => void }) => {
  const { t } = useTranslation();
  return <nav aria-label={t("ops.page", { page: page + 1 })} className="mt-5 flex flex-wrap items-center justify-between gap-3">
    <Button disabled={page === 0 || busy} onClick={() => onPage(page - 1)}>{t("ops.previous")}</Button>
    <span className="text-sm text-muted">{t("ops.page", { page: page + 1 })}</span>
    <Button disabled={!next || busy} onClick={() => onPage(page + 1)}>{t("ops.next")}</Button>
  </nav>;
};

export const operationsCard = "panel p-5 sm:p-6";
