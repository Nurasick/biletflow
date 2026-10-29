import { Alert, Button } from "antd";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../../../shared/api/auth";

export const ReportLoading = () => {
  const { t } = useTranslation();
  return <p role="status" className="flex items-center gap-2 py-8 text-sm text-[#667085]">
    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("reports.loading")}
  </p>;
};

export const ReportError = ({ error, retry, fetching }: { error: unknown; retry: () => void; fetching: boolean }) => {
  const { t } = useTranslation();
  const key = error instanceof ApiError && error.status === 401 ? "reports.sessionExpired"
    : error instanceof ApiError && error.status === 403 ? "reports.forbidden"
      : error instanceof ApiError && error.status === 404 ? "reports.notFound" : "reports.loadError";
  return <Alert role="alert" type="error" showIcon title={t(key)}
    action={<Button loading={fetching} onClick={retry}>{t("reports.retry")}</Button>} />;
};

export const ReportRefresh = ({ refresh, fetching }: { refresh: () => void; fetching: boolean }) => {
  const { t } = useTranslation();
  return <Button loading={fetching} onClick={refresh} icon={<RefreshCw size={15} aria-hidden="true" />}>
    {t("reports.refresh")}
  </Button>;
};

export const ReportPagination = ({ page, hasNext, fetching, label, onPage }: {
  page: number; hasNext: boolean; fetching: boolean; label: string; onPage: (page: number) => void;
}) => {
  const { t } = useTranslation();
  return <nav aria-label={label} className="mt-5 flex flex-wrap items-center justify-between gap-3">
    <Button disabled={page === 0 || fetching} onClick={() => onPage(page - 1)}>{t("reports.previous")}</Button>
    <span role="status" className="text-sm text-[#667085]">{t("reports.page", { page: page + 1 })}</span>
    <Button disabled={!hasNext || fetching} onClick={() => onPage(page + 1)}>{t("reports.next")}</Button>
  </nav>;
};
