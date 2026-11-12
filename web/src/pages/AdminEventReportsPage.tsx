import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { operationsKeys, validEventId } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, OperationsStatus, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi, eventReportStatuses } from "../shared/api/admin";
import type { AdminEventReport, EventReportResolution, EventReportStatus } from "../shared/api/admin";
import { parseApiInstant } from "../shared/lib/parseApiInstant";

const PAGE_SIZE = 20;
type ReportFilter = EventReportStatus | "all";
type ReportAction = { report: AdminEventReport; status: EventReportResolution };

export const AdminEventReportsPage = () => {
  const { me } = useAuth();
  return me.data?.is_platform_admin && <AdminEventReports key={me.data.id} adminId={me.data.id} />;
};

const AdminEventReports = ({ adminId }: { adminId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<ReportAction | null>(null);
  const saving = useRef(false);
  const filter = params.get("status");
  const status = filter === "all" ? "all" : eventReportStatuses.find((value) => value === filter) ?? "open";
  const requestedPage = (validEventId(params.get("page") ?? undefined) ?? 1) - 1;
  const page = Number.isSafeInteger(requestedPage * PAGE_SIZE) ? requestedPage : 0;
  const reports = useQuery({
    queryKey: operationsKeys.adminReportList(adminId, status, page),
    queryFn: ({ signal }) => adminApi.reports(status === "all" ? undefined : status, PAGE_SIZE + 1, page * PAGE_SIZE, signal),
    retry: false,
  });
  const resolve = useMutation({
    mutationFn: ({ report, status }: ReportAction) => adminApi.resolveReport(report.id, status),
    retry: false,
    onSuccess: () => setAction(null),
    onSettled: async (_data, _error, { report }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: operationsKeys.adminReports(adminId) }),
        client.invalidateQueries({ queryKey: operationsKeys.adminOverview(adminId) }),
        client.invalidateQueries({ queryKey: operationsKeys.timelines(adminId, report.event_id) }),
      ]);
      saving.current = false;
    },
  });
  const applyFilter = (filter: ReportFilter, page: number) => {
    const next = new URLSearchParams();
    if (filter !== "open") next.set("status", filter);
    if (page > 0) next.set("page", String(page + 1));
    setParams(next);
  };
  const selectAction = (report: AdminEventReport, status: EventReportResolution) => {
    resolve.reset();
    setAction({ report, status });
  };
  const selectedIsOpen = action && reports.data?.some((row) => row.id === action.report.id && row.status === "open");
  const canConfirm = selectedIsOpen && reports.isSuccess && !reports.isFetching && !resolve.isPending;
  const dismissing = action?.status === "dismissed";
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <OperationsWorkspace admin>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{t("eventReport.queue")}</h1>
      <RefreshButton refresh={() => void reports.refetch()} fetching={reports.isFetching} />
    </div>
    <div className="my-6">
      <label htmlFor="event-report-status" className="block text-sm font-semibold">{t("support.statusLabel")}</label>
      <select id="event-report-status" value={status}
        onChange={(event) => { resolve.reset(); applyFilter(event.target.value as ReportFilter, 0); }}
        className="mt-2 min-h-11 w-full max-w-60 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm">
        <option value="all">{t("support.anyStatus")}</option>
        {eventReportStatuses.map((value) => <option key={value} value={value}>{t(`eventReport.status.${value}`)}</option>)}
      </select>
    </div>
    {resolve.isSuccess && <Alert className="mb-4" type="success" showIcon role="status" title={t("eventReport.updated")} />}
    {reports.isPending ? <OperationsLoading /> : reports.isError
      ? <OperationsError error={reports.error} retry={() => void reports.refetch()} />
      : reports.data.length === 0 ? <p className={operationsCard}>{t("eventReport.empty")}</p>
        : <ul className="space-y-3">
          {reports.data.slice(0, PAGE_SIZE).map((report) => <li key={report.id} className={operationsCard}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold">
                  <Link to={`/admin/events/${report.event_id}?slug=${encodeURIComponent(report.event_slug)}`}
                    className="text-[#A93216] underline underline-offset-4">{report.event_title}</Link>
                </h2>
                <p className="mt-2 text-sm font-semibold">{t(`eventReport.reason.${report.reason}`)}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <OperationsStatus status={report.event_status} />
                <Tag color={report.status === "open" ? "gold" : report.status === "actioned" ? "green" : "default"}>
                  {t(`eventReport.status.${report.status}`)}
                </Tag>
              </div>
            </div>
            {report.details && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#475467]">{report.details}</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#667085]">
              <span>{t("eventReport.received")} · <time dateTime={report.created_at}>{date.format(parseApiInstant(report.created_at))}</time></span>
              {report.resolved_at && <span>{t("eventReport.reviewed")} · <time dateTime={report.resolved_at}>
                {date.format(parseApiInstant(report.resolved_at))}
              </time></span>}
            </p>
            {report.status === "open" && <div className="mt-4 flex flex-wrap gap-2">
              <Button size="small" disabled={reports.isFetching || resolve.isPending}
                onClick={() => selectAction(report, "dismissed")}>{t("eventReport.dismiss")}</Button>
              <Button size="small" disabled={reports.isFetching || resolve.isPending}
                onClick={() => selectAction(report, "actioned")}>{t("eventReport.markActioned")}</Button>
            </div>}
          </li>)}
        </ul>}
    <OperationsPagination page={page} next={reports.isSuccess && reports.data.length > PAGE_SIZE}
      busy={reports.isFetching || resolve.isPending} onPage={(next) => applyFilter(status, next)} />
    {action && <Modal open title={t(dismissing ? "eventReport.dismissConfirm" : "eventReport.actionedConfirm")}
      onCancel={() => { if (!saving.current) setAction(null); }}
      closable={!resolve.isPending} keyboard={!resolve.isPending} mask={{ closable: false }}
      okText={t(dismissing ? "eventReport.dismiss" : "eventReport.markActioned")} cancelText={t("ops.close")}
      confirmLoading={resolve.isPending} okButtonProps={{ disabled: !canConfirm }}
      cancelButtonProps={{ disabled: resolve.isPending }}
      onOk={() => {
        if (!canConfirm || saving.current) return;
        saving.current = true;
        resolve.mutate(action);
      }}>
      <p className="mt-3 break-words text-sm font-semibold">{action.report.event_title}</p>
      <p className="mt-1 text-sm text-[#475467]">{t(`eventReport.reason.${action.report.reason}`)}</p>
      <p className="my-4 text-sm text-[#475467]">{t(dismissing ? "eventReport.dismissDescription" : "eventReport.actionedDescription")}</p>
      {resolve.isError && <OperationsError error={resolve.error} saving />}
      {!resolve.isPending && reports.isSuccess && !selectedIsOpen && <Alert type="warning" showIcon title={t("ops.conflict")} />}
    </Modal>}
  </OperationsWorkspace>;
};
