import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { OperationsError, OperationsLoading, OperationsPagination, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { CASE_PAGE_SIZE, positiveId, queueFilters, SUPPORT_POLL_INTERVAL, supportKeys } from "../features/Support/model/supportModel";
import { CaseRow } from "../features/Support/ui/SupportCaseContent";
import { useAuth } from "../hooks/useAuth";
import { caseCategories, caseStatuses, staffSupportApi } from "../shared/api/support";

const selectClass = "mt-1.5 w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm";

export const StaffSupportPage = () => {
  const { me } = useAuth();
  return me.data && <SupportQueue key={me.data.id} userId={me.data.id} />;
};

const SupportQueue = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [eventIdError, setEventIdError] = useState(false);
  const filters = queueFilters(params);
  const requestedPage = (positiveId(params.get("page")) ?? 1) - 1;
  const page = Number.isSafeInteger(requestedPage * CASE_PAGE_SIZE) ? requestedPage : 0;
  const queue = useQuery({
    queryKey: [...supportKeys.queue(userId), filters, page],
    queryFn: ({ signal }) => staffSupportApi.queue(filters, CASE_PAGE_SIZE + 1, page * CASE_PAGE_SIZE, signal),
    refetchInterval: SUPPORT_POLL_INTERVAL, retry: false,
  });

  const pageSearch = (nextPage: number) => {
    const search = new URLSearchParams();
    if (filters.status) search.set("status", filters.status);
    if (filters.category) search.set("category", filters.category);
    if (filters.eventId) search.set("event_id", String(filters.eventId));
    if (nextPage > 0) search.set("page", String(nextPage + 1));
    return search;
  };
  const filterSearch = pageSearch(0).toString();
  const rows = queue.data?.slice(0, CASE_PAGE_SIZE) ?? [];
  return <main className="min-h-[60vh] bg-[#F5F5F0] px-4 py-8 sm:px-7 sm:py-10">
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("support.queue")}</h1>
        <RefreshButton refresh={() => void queue.refetch()} fetching={queue.isFetching} />
      </div>
      <form key={filterSearch} className="space-y-4 rounded-xl border border-[#D0D5DD] bg-white p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const eventId = fields.get("event_id")?.toString().trim();
        if (eventId && positiveId(eventId) === undefined) {
          setEventIdError(true);
          return;
        }
        setEventIdError(false);
        const search = new URLSearchParams();
        for (const name of ["status", "category", "event_id"]) {
          const value = fields.get(name)?.toString().trim();
          if (value) search.set(name, value);
        }
        if (search.toString() === filterSearch && page === 0) void queue.refetch();
        else setParams(search);
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">{t("support.statusLabel")}
            <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
              <option value="">{t("support.anyStatus")}</option>
              {caseStatuses.map((status) => <option key={status} value={status}>{t(`support.status.${status}`)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{t("support.categoryLabel")}
            <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
              <option value="">{t("support.anyCategory")}</option>
              {caseCategories.map((category) => <option key={category} value={category}>{t(`support.category.${category}`)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{t("support.eventId")}
            <Input name="event_id" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={16}
              defaultValue={filters.eventId} className="mt-1.5" onChange={() => setEventIdError(false)}
              aria-invalid={eventIdError} aria-describedby={eventIdError ? "support-event-id-error" : undefined} />
            {eventIdError && <span id="support-event-id-error" role="alert" className="mt-1 block text-xs text-[#A93216]">
              {t("support.invalidEventId")}
            </span>}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button htmlType="submit" type="primary">{t("reports.applyFilters")}</Button>
          <Button htmlType="reset" onClick={() => {
            setEventIdError(false);
            if (params.size) setParams({});
          }}>{t("reports.clearFilters")}</Button>
        </div>
      </form>
      {queue.isPending ? <OperationsLoading /> : queue.isError
        ? <OperationsError error={queue.error} retry={() => void queue.refetch()} /> : rows.length === 0
        ? <p className="rounded-xl border border-[#D0D5DD] bg-white p-5 text-sm text-[#667085]">{t("support.queueEmpty")}</p>
        : <ul className="space-y-3">
          {rows.map((summary) => <CaseRow key={summary.case_number} summary={summary}
            href={`/staff/support/${encodeURIComponent(summary.case_number)}`} queueSearch={pageSearch(page).toString()}>
            <p className="break-all text-sm text-[#475467]">{summary.contact_email}</p>
            {summary.event_id !== null && <p className="text-xs text-[#667085]">{t("ops.eventId", { id: summary.event_id })}</p>}
          </CaseRow>)}
        </ul>}
      {(page > 0 || (queue.isSuccess && queue.data.length > CASE_PAGE_SIZE)) && <OperationsPagination
        page={page} next={queue.isSuccess && queue.data.length > CASE_PAGE_SIZE} busy={queue.isFetching}
        onPage={(next) => setParams(pageSearch(next))} />}
    </div>
  </main>;
};
