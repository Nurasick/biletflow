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
import { adminApi } from "../shared/api/admin";

const PAGE_SIZE = 20;

export const AdminEventsPage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { me } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const pageNumber = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 && pageNumber <= 100_000 ? pageNumber - 1 : 0;
  const [draft, setDraft] = useState(query);
  const events = useQuery({
    queryKey: operationsKeys.adminList(me.data?.id, query, page),
    queryFn: ({ signal }) => adminApi.events(query, PAGE_SIZE + 1, page * PAGE_SIZE, signal),
    enabled: Boolean(me.data?.is_platform_admin), retry: false,
  });
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (nextPage > 0) next.set("page", String(nextPage + 1));
    setParams(next);
  };
  return <OperationsWorkspace admin>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-bold tracking-tight">{t("ops.adminEvents")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">{t("ops.adminDescription")}</p></div>
      <RefreshButton refresh={() => void events.refetch()} fetching={events.isFetching} />
    </div>
    <form className="my-6 max-w-xl space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const value = draft.trim();
      if (value === query && page === 0) void events.refetch();
      else setParams(value ? { q: value } : {});
    }}>
      <label htmlFor="admin-event-search" className="block text-sm font-semibold">{t("ops.eventSearchLabel")}</label>
      <div className="flex gap-2"><Input id="admin-event-search" type="search" value={draft} maxLength={100}
        onChange={(event) => setDraft(event.target.value)} className="min-w-0 flex-1" />
        <Button htmlType="submit" type="primary" loading={events.isFetching}>{t("ops.search")}</Button></div>
    </form>
    {events.isPending ? <OperationsLoading /> : events.isError ? <OperationsError error={events.error} retry={() => void events.refetch()} />
      : events.data.length === 0 ? <p className="rounded-2xl border border-[#D0D5DD] bg-white p-8 text-sm text-[#667085]">{t("ops.noEvents")}</p>
        : <ul className="space-y-3">
          {events.data.slice(0, PAGE_SIZE).map((event) => <li key={event.id}>
            <Link to={`/admin/events/${event.id}?slug=${encodeURIComponent(event.slug)}`}
              onClick={() => client.setQueryData(operationsKeys.adminEvent(me.data?.id, event.id), event)}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#D0D5DD] bg-white p-5 transition-colors hover:border-[#FF5C35] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5C35]">
              <div className="min-w-0 flex-1"><p className="text-xs text-[#667085]">{t("ops.eventId", { id: event.id })}</p>
                <h2 className="mt-1 break-words text-lg font-semibold">{event.title}</h2>
                <p className="mt-2 text-xs leading-5 text-[#667085]">{event.venue_name} · {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium", timeStyle: "short", timeZone: event.timezone,
                }).format(new Date(event.starts_at))} · {event.timezone}</p></div>
              <OperationsStatus status={event.status} />
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#A93216]">{t("ops.openModeration")}<ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
          </li>)}
        </ul>}
    <OperationsPagination page={page} next={Boolean(events.data && events.data.length > PAGE_SIZE)} busy={events.isFetching || events.isError} onPage={setPage} />
  </OperationsWorkspace>;
};
