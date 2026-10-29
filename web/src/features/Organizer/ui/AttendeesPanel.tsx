import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import { Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { eventReportsApi } from "../../../shared/api/eventReports";
import { eventReportKeys, REPORT_PAGE_SIZE, reportPage } from "../model/eventReportModel";
import { ReportError, ReportLoading, ReportPagination, ReportRefresh } from "./ReportControls";

const statusKeys = {
  valid: "reports.ticketValid", checked_in: "reports.ticketCheckedIn",
  cancelled: "reports.ticketCancelled", refunded: "reports.ticketRefunded",
} as const;

export const AttendeesPanel = ({ eventId, userId }: { eventId: number; userId: number }) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const attendees = useQuery({
    queryKey: eventReportKeys.attendees(userId, eventId, page),
    queryFn: ({ signal }) => eventReportsApi.attendees(eventId, { ...reportPage(page), signal }),
    retry: false,
  });
  return <section id="event-attendees" aria-labelledby="event-attendees-title"
    className="scroll-mt-6 rounded-xl border border-[#D0D5DD] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="event-attendees-title" className="flex items-center gap-2 font-semibold">
        <Users size={18} aria-hidden="true" />{t("reports.attendeesTitle")}
      </h2>
      <ReportRefresh refresh={() => void attendees.refetch()} fetching={attendees.isFetching} />
    </div>
    <p className="mt-2 text-sm leading-6 text-[#667085]">{t("reports.attendeesDescription")}</p>
    <div className="mt-4" aria-busy={attendees.isFetching}>
      {attendees.isPending ? <ReportLoading /> : attendees.isError
        ? <ReportError error={attendees.error} retry={() => void attendees.refetch()} fetching={attendees.isFetching} />
        : attendees.data.length === 0 ? <p role="status" className="py-4 text-sm text-[#667085]">{t("reports.attendeesEmpty")}</p>
          : <div role="region" aria-labelledby="event-attendees-title" tabIndex={0}
            className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C35]">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-[#D0D5DD] text-xs text-[#667085]">
                <tr>{(["reports.attendee", "reports.ticket", "reports.ticketType", "reports.status", "reports.order", "reports.email", "reports.phone"] as const).map(
                  (key) => <th scope="col" key={key} className="px-3 py-3 first:pl-0">{t(key)}</th>,
                )}</tr>
              </thead>
              <tbody className="divide-y divide-[#EAECF0]">
                {attendees.data.slice(0, REPORT_PAGE_SIZE).map((row) => <tr key={row.public_code}>
                  <th scope="row" className="max-w-56 break-words py-3 pr-3 font-semibold">{row.full_name}</th>
                  <td className="px-3 py-3 font-mono text-xs">{row.public_code}</td>
                  <td className="max-w-48 break-words px-3 py-3">{row.ticket_type_name}</td>
                  <td className="px-3 py-3"><Tag>{statusKeys[row.ticket_status as keyof typeof statusKeys]
                    ? t(statusKeys[row.ticket_status as keyof typeof statusKeys]) : row.ticket_status}</Tag></td>
                  <td className="px-3 py-3 font-mono text-xs">{row.order_number}</td>
                  <td className="max-w-60 break-words px-3 py-3">{row.email || t("reports.missingContact")}</td>
                  <td className="px-3 py-3">{row.phone || t("reports.missingContact")}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
    </div>
    <ReportPagination page={page} onPage={setPage} label={t("reports.attendeesTitle")} fetching={attendees.isFetching}
      hasNext={!attendees.isError && Boolean(attendees.data && attendees.data.length > REPORT_PAGE_SIZE)} />
  </section>;
};
