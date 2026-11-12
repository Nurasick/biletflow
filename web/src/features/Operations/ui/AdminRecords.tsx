import { useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useId } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { AdminPageRequest } from "../../../shared/api/admin";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";
import { validEventId } from "../model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, RefreshButton, operationsCard } from "./OperationsWorkspace";

const PAGE_SIZE = 20;

type AdminRecordsProps<Row> = {
  title: string;
  empty: string;
  queryKey: QueryKey;
  load: (page: AdminPageRequest) => Promise<Row[]>;
  rowKey: (row: Row) => string | number;
  columns: { label: string; cell: (row: Row) => ReactNode }[];
  filters?: ReactNode;
  actions?: ReactNode;
};

export const AdminRecords = <Row,>({
  title, empty, queryKey, load, rowKey, columns, filters, actions,
}: AdminRecordsProps<Row>) => {
  const headingId = useId();
  const [params, setParams] = useSearchParams();
  const requestedPage = (validEventId(params.get("page") ?? undefined) ?? 1) - 1;
  const page = Number.isSafeInteger(requestedPage * PAGE_SIZE) ? requestedPage : 0;
  const records = useQuery({
    queryKey: [...queryKey, page],
    queryFn: ({ signal }) => load({ limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE, signal }),
    retry: false,
  });
  const refresh = () => void records.refetch();

  return <section className={operationsCard} aria-labelledby={headingId}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 id={headingId} className="text-xl font-bold">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <RefreshButton refresh={refresh} fetching={records.isFetching} />
      </div>
    </div>
    {filters}
    <div className="mt-4" aria-busy={records.isFetching}>
      {records.isPending ? <OperationsLoading /> : records.isError
        ? <OperationsError error={records.error} retry={refresh} />
        : records.data.length === 0 ? <p role="status" className="py-4 text-sm text-[#667085]">{empty}</p>
          : <div role="region" aria-labelledby={headingId} tabIndex={0}
            className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C35]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#D0D5DD] text-xs text-[#475467]">
                <tr>{columns.map(({ label }) => <th key={label} scope="col" className="px-3 py-3 first:pl-0">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#EAECF0]">
                {records.data.slice(0, PAGE_SIZE).map((row) => <tr key={rowKey(row)} className="align-top">
                  {columns.map(({ label, cell }, index) => index === 0
                    ? <th key={label} scope="row" className="max-w-64 py-3 pr-3 font-semibold [overflow-wrap:anywhere]">{cell(row)}</th>
                    : <td key={label} className="max-w-64 px-3 py-3 [overflow-wrap:anywhere]">{cell(row)}</td>)}
                </tr>)}
              </tbody>
            </table>
          </div>}
    </div>
    <OperationsPagination page={page} next={records.isSuccess && records.data.length > PAGE_SIZE}
      busy={records.isFetching} onPage={(nextPage) => {
        const next = new URLSearchParams(params);
        if (nextPage > 0) next.set("page", String(nextPage + 1)); else next.delete("page");
        setParams(next);
      }} />
  </section>;
};

export const AdminRecordNavigation = ({ label, current, links }: {
  label: string; current: string; links: { id: string; to: string; label: string }[];
}) => (
  <nav aria-label={label} className="my-5 flex flex-wrap gap-3">
    {links.map((link) => <Link key={link.id} to={link.to} aria-current={current === link.id ? "page" : undefined}
      className={`rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
        current === link.id ? "border-[#101828] bg-[#101828] text-white" : "border-[#D0D5DD] bg-white text-[#475467] hover:border-[#101828]"
      }`}>{link.label}</Link>)}
  </nav>
);

export const AdminRecordEventLink = ({ id, title }: { id: number; title?: string }) => {
  const { t } = useTranslation();
  return <Link to={`/admin/events/${id}`} className="font-semibold text-[#A93216] underline underline-offset-2">
    {title ?? t("ops.eventId", { id })}
  </Link>;
};

export const AdminRecordTime = ({ value, format }: { value: string; format: Intl.DateTimeFormat }) =>
  <time dateTime={value} className="whitespace-nowrap">{format.format(parseApiInstant(value))}</time>;
