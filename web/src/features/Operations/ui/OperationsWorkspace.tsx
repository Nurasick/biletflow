import { Alert, Button, ConfigProvider, Tag } from "antd";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError } from "../../../shared/api/auth";

export const OperationsWorkspace = ({ children, admin = false, detail = false }: { children: ReactNode; admin?: boolean; detail?: boolean }) => {
  const { t } = useTranslation();
  return <ConfigProvider theme={{ token: {
    colorPrimary: "#FF5C35", colorText: "#101828", colorBorder: "#D0D5DD",
    borderRadius: 9, controlHeight: 44, fontSize: 14,
  }, components: { Button: { primaryColor: "#101828" } } }}>
    <main className="min-h-[60vh] bg-[#F5F5F0] px-4 py-8 text-[#101828] sm:px-7 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to={detail ? admin ? "/admin/events" : "/staff/events" : "/account"}
            className="inline-flex items-center gap-2 rounded text-sm text-[#475467] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5C35]">
            <ArrowLeft size={16} aria-hidden="true" />{t(detail ? "ops.back" : "ops.account")}
          </Link>
          <span className="rounded-full border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#475467]">
            {t(admin ? "ops.adminWorkspace" : "ops.staffWorkspace")}
          </span>
        </div>
        {children}
      </div>
    </main>
  </ConfigProvider>;
};

export const OperationsLoading = () => {
  const { t } = useTranslation();
  return <div role="status" className="flex items-center gap-2 py-10 text-sm text-[#667085]">
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

export const RefreshButton = ({ refresh, fetching }: { refresh: () => void; fetching: boolean }) => {
  const { t } = useTranslation();
  return <Button onClick={refresh} loading={fetching} icon={<RefreshCw size={15} aria-hidden="true" />}>
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
    <span className="text-sm text-[#667085]">{t("ops.page", { page: page + 1 })}</span>
    <Button disabled={!next || busy} onClick={() => onPage(page + 1)}>{t("ops.next")}</Button>
  </nav>;
};

export const operationsCard = "rounded-2xl border border-[#D0D5DD] bg-white p-5 sm:p-6";
