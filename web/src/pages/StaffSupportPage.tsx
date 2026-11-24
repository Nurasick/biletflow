import { useQuery } from "@tanstack/react-query";
import { Button, Input, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import {
  CASE_PAGE_SIZE, positiveId, QUEUE_QUERY_MAX, queueFilters, queueSearch, SUPPORT_POLL_INTERVAL, supportKeys,
} from "../features/Support/model/supportModel";
import { CaseRow } from "../features/Support/ui/SupportCaseContent";
import { useAuth } from "../hooks/useAuth";
import { checkInApi } from "../shared/api/staff";
import { caseAudiences, caseCategories, caseStatuses, staffSupportApi } from "../shared/api/support";
import type { CaseAudience, CaseCategory, CaseStatus, QueueFilters } from "../shared/api/support";

const selectClass = "mt-1.5 block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm font-normal";

export const StaffSupportPage = () => {
  const { me } = useAuth();
  return me.data && <SupportQueue key={me.data.id} userId={me.data.id} />;
};

const SupportQueue = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = queueFilters(params);
  const requestedPage = (positiveId(params.get("page")) ?? 1) - 1;
  const page = Number.isSafeInteger(requestedPage * CASE_PAGE_SIZE) ? requestedPage : 0;
  const queue = useQuery({
    queryKey: [...supportKeys.queue(userId), filters, page],
    queryFn: ({ signal }) => staffSupportApi.queue(filters, CASE_PAGE_SIZE + 1, page * CASE_PAGE_SIZE, signal),
    refetchInterval: SUPPORT_POLL_INTERVAL, retry: false,
  });
  // The event picker lists events this account organizes or staffs; admins may
  // have none, and still filter by any event reached through a link.
  const events = useQuery({
    queryKey: operationsKeys.staffEvents(userId),
    queryFn: ({ signal }) => checkInApi.events(signal),
    retry: false,
  });
  const eventOptions = events.data ?? [];
  const unlistedEvent = filters.eventId !== undefined && !eventOptions.some((event) => event.id === filters.eventId);

  const filterSearch = queueSearch(filters).toString();
  const rows = queue.data?.slice(0, CASE_PAGE_SIZE) ?? [];
  const activeFilters = filterSearch !== "";
  return <main className="min-h-[60vh] bg-paper px-4 py-8 sm:px-7 sm:py-10">
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("support.queue")}</h1>
        <RefreshButton refresh={() => void queue.refetch()} fetching={queue.isFetching} />
      </div>
      <form key={filterSearch} role="search" aria-label={t("support.queueFilters")}
        className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5" onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const value = (name: string) => fields.get(name)?.toString().trim() ?? "";
          const next: QueueFilters = {
            status: (value("status") || undefined) as CaseStatus | undefined,
            category: (value("category") || undefined) as CaseCategory | undefined,
            audience: (value("audience") || undefined) as CaseAudience | undefined,
            eventId: positiveId(value("event_id")),
            ...(fields.get("escalated") === "true" && { escalated: true }),
            ...(value("q") && { query: value("q").slice(0, QUEUE_QUERY_MAX) }),
          };
          const search = queueSearch(next);
          if (search.toString() === filterSearch && page === 0) void queue.refetch();
          else setParams(search);
        }}>
        <div>
          <label htmlFor="support-queue-search" className="text-sm font-semibold">{t("support.queueSearch")}</label>
          <Input id="support-queue-search" name="q" type="search" maxLength={QUEUE_QUERY_MAX} defaultValue={filters.query}
            className="mt-1.5" aria-describedby="support-queue-search-hint" />
          <p id="support-queue-search-hint" className="mt-1 text-xs text-muted">{t("support.queueSearchHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="support-queue-status" className="text-sm font-semibold">{t("support.statusLabel")}</label>
            <select id="support-queue-status" name="status" defaultValue={filters.status ?? ""} className={selectClass}>
              <option value="">{t("support.anyStatus")}</option>
              {caseStatuses.map((status) => <option key={status} value={status}>{t(`support.status.${status}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="support-queue-category" className="text-sm font-semibold">{t("support.categoryLabel")}</label>
            <select id="support-queue-category" name="category" defaultValue={filters.category ?? ""} className={selectClass}>
              <option value="">{t("support.anyCategory")}</option>
              {caseCategories.map((category) => <option key={category} value={category}>{t(`support.category.${category}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="support-queue-audience" className="text-sm font-semibold">{t("support.audienceLabel")}</label>
            <select id="support-queue-audience" name="audience" defaultValue={filters.audience ?? ""} className={selectClass}>
              <option value="">{t("support.anyAudience")}</option>
              {caseAudiences.map((audience) => <option key={audience} value={audience}>{t(`support.audience.${audience}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="support-queue-event" className="text-sm font-semibold">{t("support.eventLabel")}</label>
            <select id="support-queue-event" name="event_id" defaultValue={filters.eventId ?? ""} className={selectClass}
              aria-busy={events.isPending} aria-describedby={events.isError ? "support-event-error" : undefined}>
              <option value="">{t("support.anyEvent")}</option>
              {unlistedEvent && <option value={filters.eventId}>{t("ops.eventId", { id: filters.eventId })}</option>}
              {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
            </select>
            {events.isError && <p id="support-event-error" className="mt-1 text-xs text-muted">{t("support.eventsUnavailable")}</p>}
          </div>
        </div>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="escalated" value="true" defaultChecked={filters.escalated === true}
            className="size-4 accent-primary" />
          {t("support.escalatedOnly")}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
          <Button htmlType="reset" disabled={!activeFilters && page === 0}
            onClick={() => { if (params.size) setParams({}); }}>{t("reports.clearFilters")}</Button>
        </div>
      </form>
      <div aria-live="polite" aria-busy={queue.isFetching}>
        {queue.isPending ? <OperationsLoading /> : queue.isError
          ? <OperationsError error={queue.error} retry={() => void queue.refetch()} /> : rows.length === 0
          ? <p role="status" className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
            {t(activeFilters ? "support.queueNoMatch" : "support.queueEmpty")}</p>
          : <ul className="space-y-3" aria-label={t("support.queueResults")}>
            {rows.map((summary) => <CaseRow key={summary.case_number} summary={summary}
              href={`/staff/support/${encodeURIComponent(summary.case_number)}`} queueSearch={queueSearch(filters, page).toString()}>
              <p className="break-all text-sm text-muted-strong">{summary.contact_email}</p>
              <div className="flex flex-wrap items-center gap-2">
                {summary.event_id !== null && <span className="text-xs text-muted">
                  {eventOptions.find((event) => event.id === summary.event_id)?.title ?? t("ops.eventId", { id: summary.event_id })}
                </span>}
                {summary.is_escalated && <Tag color="volcano">{t("support.escalated")}</Tag>}
              </div>
            </CaseRow>)}
          </ul>}
      </div>
      {(page > 0 || (queue.isSuccess && queue.data.length > CASE_PAGE_SIZE)) && <OperationsPagination
        page={page} next={queue.isSuccess && queue.data.length > CASE_PAGE_SIZE} busy={queue.isFetching}
        onPage={(next) => setParams(queueSearch(filters, next))} />}
    </div>
  </main>;
};
