import { useQuery } from "@tanstack/react-query";
import { Alert, Tag } from "antd";
import { Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { eventReportsApi } from "../../../shared/api/eventReports";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";
import { clientPage, eventReportKeys, fetchAllRows, matchesSearch } from "../model/eventReportModel";
import { eventInputClass } from "./EventFormField";
import { ReportError, ReportLoading, ReportPagination, ReportRefresh } from "./ReportControls";

const statusKeys = {
  valid: "reports.ticketValid", checked_in: "reports.ticketCheckedIn",
  cancelled: "reports.ticketCancelled", refunded: "reports.ticketRefunded",
} as const;
type TicketStatus = keyof typeof statusKeys;

export const AttendeesPanel = ({ eventId, userId, slug }: { eventId: number; userId: number; slug: string }) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [ticketType, setTicketType] = useState("");
  const attendees = useQuery({
    queryKey: eventReportKeys.allAttendees(userId, eventId),
    queryFn: ({ signal }) => fetchAllRows((options) => eventReportsApi.attendees(eventId, options), signal),
    retry: false,
  });
  const rows = attendees.data?.rows ?? [];
  const ticketTypes = [...new Set(rows.map((row) => row.ticket_type_name))].sort((a, b) => a.localeCompare(b));
  const filtered = rows.filter((row) => (!status || row.ticket_status === status)
    && (!ticketType || row.ticket_type_name === ticketType)
    && matchesSearch(search, [row.full_name, row.email, row.phone, row.public_code, row.order_number]));
  const visible = clientPage(filtered, page);
  const filtering = Boolean(search.trim() || status || ticketType);
  const filter = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(0); };

  return <section id="event-attendees" aria-labelledby="event-attendees-title"
    className="scroll-mt-6 rounded-xl border border-line bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="event-attendees-title" className="flex items-center gap-2 font-semibold">
        <Users size={18} aria-hidden="true" />{t("reports.attendeesTitle")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <ReportRefresh refresh={() => void attendees.refetch()} fetching={attendees.isFetching} />
        <FileDownloadButton label={t("reports.attendeesCsv")} filename={`attendees-${slug}.csv`}
          getFile={() => eventReportsApi.attendeesCsv(eventId)} />
      </div>
    </div>
    <p className="mt-2 text-sm leading-6 text-muted">{t("reports.attendeesDescription")}</p>
    <div role="search" className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <label className="min-w-0 text-xs font-semibold">{t("reports.search")}
        <input type="search" value={search} placeholder={t("reports.attendeeSearchPlaceholder")}
          onChange={(event) => filter(setSearch)(event.target.value)} className={`mt-1.5 ${eventInputClass}`} />
      </label>
      <label className="min-w-0 text-xs font-semibold">{t("reports.status")}
        <select value={status} onChange={(event) => filter(setStatus)(event.target.value as TicketStatus | "")}
          className={`mt-1.5 ${eventInputClass}`}>
          <option value="">{t("reports.allStatuses")}</option>
          {(Object.keys(statusKeys) as TicketStatus[]).map((key) => <option key={key} value={key}>{t(statusKeys[key])}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-xs font-semibold">{t("reports.ticketType")}
        <select value={ticketType} onChange={(event) => filter(setTicketType)(event.target.value)}
          className={`mt-1.5 ${eventInputClass}`}>
          <option value="">{t("campaigns.allTypes")}</option>
          {ticketTypes.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    {attendees.isSuccess && filtering && <p role="status" className="mt-3 text-xs text-muted">
      {t("reports.matches", { count: filtered.length, total: rows.length })}
    </p>}
    {attendees.data?.truncated && <Alert type="warning" showIcon className="mt-3" title={t("reports.truncated", { count: rows.length })} />}
    <div className="mt-4" aria-busy={attendees.isFetching}>
      {attendees.isPending ? <ReportLoading /> : attendees.isError
        ? <ReportError error={attendees.error} retry={() => void attendees.refetch()} fetching={attendees.isFetching} />
        : filtered.length === 0 ? <p role="status" className="py-4 text-sm text-muted">
          {t(rows.length === 0 ? "reports.attendeesEmpty" : "reports.noMatches")}
        </p>
          : <div role="region" aria-labelledby="event-attendees-title" tabIndex={0}
            className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>{(["reports.attendee", "reports.ticket", "reports.ticketType", "reports.status", "reports.order", "reports.email", "reports.phone"] as const).map(
                  (key) => <th scope="col" key={key} className="px-3 py-3 first:pl-0">{t(key)}</th>,
                )}</tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {visible.rows.map((row) => <tr key={row.public_code}>
                  <th scope="row" className="max-w-56 break-words py-3 pr-3 font-semibold">{row.full_name}</th>
                  <td className="px-3 py-3 font-mono text-xs">{row.public_code}</td>
                  <td className="max-w-48 break-words px-3 py-3">{row.ticket_type_name}</td>
                  <td className="px-3 py-3"><Tag>{row.ticket_status in statusKeys
                    ? t(statusKeys[row.ticket_status as TicketStatus]) : row.ticket_status}</Tag></td>
                  <td className="px-3 py-3 font-mono text-xs">{row.order_number}</td>
                  <td className="max-w-60 break-words px-3 py-3">{row.email || t("reports.missingContact")}</td>
                  <td className="px-3 py-3">{row.phone || t("reports.missingContact")}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
    </div>
    {(page > 0 || visible.hasNext) && <ReportPagination page={page} onPage={setPage} label={t("reports.attendeesTitle")}
      fetching={attendees.isFetching} hasNext={visible.hasNext} />}
  </section>;
};
