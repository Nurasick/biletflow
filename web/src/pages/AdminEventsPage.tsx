import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, OperationsStatus, OperationsWorkspace, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi, adminEventStatuses } from "../shared/api/admin";
import { FileDownloadButton } from "../shared/ui/FileDownloadButton";

const PAGE_SIZE = 20;
const statusLabels = {
  draft: "ops.statusDraft", published: "ops.statusPublished", suspended: "ops.statusSuspended", cancelled: "ops.statusCancelled",
} as const;

export const AdminEventsPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const status = adminEventStatuses.find((value) => value === params.get("status"));
  const pageNumber = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 && pageNumber <= 100_000 ? pageNumber - 1 : 0;
  const [draft, setDraft] = useState(query);
  const events = useQuery({
    queryKey: operationsKeys.adminList(me.data?.id, query, page, status),
    queryFn: ({ signal }) => adminApi.events(query, PAGE_SIZE + 1, page * PAGE_SIZE, signal, status),
    enabled: Boolean(me.data?.is_platform_admin), retry: false,
  });
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (status) next.set("status", status);
    if (nextPage > 0) next.set("page", String(nextPage + 1));
    setParams(next);
  };
  return <OperationsWorkspace admin>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="page-title">{t("ops.adminEvents")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{t("ops.adminDescription")}</p></div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <FileDownloadButton filename="biletflow-events.csv" label={t("adminFinance.exportEvents")}
            getFile={() => adminApi.exportCsv("events", { query, status })} />
          <p className="mt-1 text-xs text-muted">{t("adminFinance.exportScope")}</p>
        </div>
        <RefreshButton refresh={() => void events.refetch()} fetching={events.isFetching} />
      </div>
    </div>
    <form className="my-6 flex max-w-3xl flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      const value = draft.trim();
      const selection = String(new FormData(event.currentTarget).get("status") ?? "");
      if (value === query && selection === (status ?? "") && page === 0) { void events.refetch(); return; }
      const next = new URLSearchParams();
      if (value) next.set("q", value);
      if (selection) next.set("status", selection);
      setParams(next);
    }}>
      <div className="min-w-0 flex-1 basis-64">
        <label htmlFor="admin-event-search" className="mb-1.5 block text-sm font-semibold">{t("ops.eventSearchLabel")}</label>
        <Input id="admin-event-search" type="search" value={draft} maxLength={100}
          onChange={(event) => setDraft(event.target.value)} />
      </div>
      <div>
        <label htmlFor="admin-event-status" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
        <select id="admin-event-status" name="status" key={status ?? ""} defaultValue={status ?? ""}
          className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm">
          <option value="">{t("support.anyStatus")}</option>
          {adminEventStatuses.map((value) => <option key={value} value={value}>{t(statusLabels[value])}</option>)}
        </select>
      </div>
      <Button htmlType="submit" type="primary" loading={events.isFetching}>{t("ops.search")}</Button>
    </form>
    {events.isPending ? <OperationsLoading /> : events.isError ? <OperationsError error={events.error} retry={() => void events.refetch()} />
      : events.data.length === 0 ? <p className="panel p-8 text-sm text-muted">{t("ops.noEvents")}</p>
        : <ul className="space-y-3">
          {events.data.slice(0, PAGE_SIZE).map((event) => <li key={event.id}>
            <Link to={`/admin/events/${event.id}?slug=${encodeURIComponent(event.slug)}`}
              onClick={() => client.setQueryData(operationsKeys.adminEvent(me.data?.id, event.id), event)}
              className="flex flex-wrap items-center justify-between gap-4 panel p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              <div className="min-w-0 flex-1"><p className="text-xs text-muted">{t("ops.eventId", { id: event.id })}</p>
                <h2 className="mt-1 break-words text-lg font-semibold">{event.title}</h2>
                <p className="mt-2 text-xs leading-5 text-muted">{event.venue_name} · {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium", timeStyle: "short", timeZone: event.timezone,
                }).format(new Date(event.starts_at))} · {event.timezone}</p></div>
              <OperationsStatus status={event.status} />
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary-hover">{t("ops.openModeration")}<ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
          </li>)}
        </ul>}
    <OperationsPagination page={page} next={Boolean(events.data && events.data.length > PAGE_SIZE)} busy={events.isFetching || events.isError} onPage={setPage} />
  </OperationsWorkspace>;
};
