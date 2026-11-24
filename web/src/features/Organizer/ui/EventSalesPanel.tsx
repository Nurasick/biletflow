import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { BarChart3 } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import { salesApi } from "../../../shared/api/eventManagement";
import type { EventSummary, OrganizerOrder } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { clientPage, eventReportKeys, fetchAllRows, matchesSearch } from "../model/eventReportModel";
import { eventInputClass } from "./EventFormField";
import { ReportError, ReportLoading, ReportPagination, ReportRefresh } from "./ReportControls";

// §4.6 gross/refunds/payout, §4.15 capacity and attendance, §4.9 cancel and
// refund. Every amount is simulated money, and the panel says so.
export const EventSalesPanel = ({ eventId, userId }: { eventId: number; userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const summaryKey = eventReportKeys.summary(userId, eventId);
  const ordersKey = eventReportKeys.orders(userId, eventId);
  const summary = useQuery({
    queryKey: summaryKey, queryFn: ({ signal }) => salesApi.summary(eventId, signal), retry: false,
  });
  const orders = useQuery({
    queryKey: eventReportKeys.allOrders(userId, eventId),
    queryFn: ({ signal }) => fetchAllRows((options) => salesApi.orders(eventId, options), signal),
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrganizerOrder["status"] | "">("");
  const rows = orders.data?.rows ?? [];
  const filtered = rows.filter((order) => (!status || order.status === status)
    && matchesSearch(search, [order.contact_name, order.contact_email, order.order_number]));
  const visible = clientPage(filtered, page);
  const [target, setTarget] = useState<OrganizerOrder | null>(null);
  const [reason, setReason] = useState("");
  const isRefund = (order: OrganizerOrder | null) => Boolean(order && order.total_minor > 0);
  const settle = useMutation({
    mutationFn: (order: OrganizerOrder) => isRefund(order)
      ? salesApi.refund(eventId, order.order_number, reason.trim())
      : salesApi.cancel(eventId, order.order_number),
    onSuccess: async () => {
      setTarget(null);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: summaryKey }),
        queryClient.invalidateQueries({ queryKey: ordersKey }),
        queryClient.invalidateQueries({ queryKey: ["organizer", "attendees", userId, eventId] }),
        queryClient.invalidateQueries({ queryKey: ["organizer", "timeline", userId, eventId] }),
      ]);
    },
  });
  const money = (minor: number) => formatMinor(minor, locale);

  return (
    <section id="event-sales" aria-labelledby="sales" className="scroll-mt-6 rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sales" className="flex items-center gap-2 font-semibold"><BarChart3 size={18} aria-hidden="true" />{t("sales.title")}</h2>
        <ReportRefresh refresh={() => { void summary.refetch(); void orders.refetch(); }} fetching={summary.isFetching || orders.isFetching} />
      </div>
      <div className="mt-4" aria-busy={summary.isFetching}>
        {summary.isPending ? <ReportLoading /> : summary.isError
          ? <ReportError error={summary.error} retry={() => void summary.refetch()} fetching={summary.isFetching} />
          : <SalesBreakdown summary={summary.data} t={t} locale={locale} />}
      </div>
      <h3 className="mt-6 text-sm font-semibold">{t("sales.orders")}</h3>
      <div role="search" className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="min-w-0 text-xs font-semibold">{t("reports.search")}
          <input type="search" value={search} placeholder={t("sales.searchPlaceholder")}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }} className={`mt-1.5 ${eventInputClass}`} />
        </label>
        <label className="min-w-0 text-xs font-semibold">{t("reports.status")}
          <select value={status} className={`mt-1.5 ${eventInputClass}`}
            onChange={(event) => { setStatus(event.target.value as OrganizerOrder["status"] | ""); setPage(0); }}>
            <option value="">{t("reports.allStatuses")}</option>
            {(["confirmed", "cancelled", "refunded", "partially_refunded"] as const).map((key) =>
              <option key={key} value={key}>{t(`orderStatus.${key}`)}</option>)}
          </select>
        </label>
      </div>
      {orders.isSuccess && (search.trim() || status) && <p role="status" className="mt-3 text-xs text-muted">
        {t("reports.matches", { count: filtered.length, total: rows.length })}
      </p>}
      {orders.data?.truncated && <Alert type="warning" showIcon className="mt-3" title={t("reports.truncated", { count: rows.length })} />}
      <div aria-busy={orders.isFetching}>
        {orders.isPending ? <ReportLoading /> : orders.isError
          ? <ReportError error={orders.error} retry={() => void orders.refetch()} fetching={orders.isFetching} />
          : filtered.length === 0 ? <p role="status" className="mt-2 text-sm text-muted">{t(rows.length === 0 ? "sales.noOrders" : "reports.noMatches")}</p>
            : <ul className="mt-2 divide-y divide-line-soft">
              {visible.rows.map((order) => <li key={order.order_number}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{order.contact_name} <span className="font-mono text-xs text-muted">{order.order_number}</span></p>
                  <p className="text-xs text-muted">{t("sales.orderLine", { count: order.ticket_count })} · {money(order.total_minor)} · {t(`orderStatus.${order.status}`)}</p>
                </div>
                {order.status === "confirmed" && <Button size="small" danger onClick={() => { settle.reset(); setReason(""); setTarget(order); }}>
                  {t(order.total_minor > 0 ? "sales.refund" : "sales.cancelRegistration")}
                </Button>}
              </li>)}
            </ul>}
      </div>
      {(page > 0 || visible.hasNext) && <ReportPagination page={page}
        hasNext={visible.hasNext} fetching={orders.isFetching}
        label={t("sales.orders")} onPage={setPage} />}
      <Modal open={target !== null} title={target ? t(isRefund(target) ? "sales.refund" : "sales.cancelRegistration") : ""}
        okText={t("sales.confirm")} confirmLoading={settle.isPending}
        okButtonProps={{ danger: true, disabled: isRefund(target) && !reason.trim() }}
        onCancel={() => { if (!settle.isPending) setTarget(null); }}
        onOk={() => { if (target && (!isRefund(target) || reason.trim())) settle.mutate(target); }}>
        <p>{t("sales.confirmDescription", { order: target?.order_number ?? "" })}</p>
        {isRefund(target) && <label className="mt-4 block text-sm font-semibold" htmlFor="refund-reason">
          {t("sales.refundReason")}<span aria-hidden="true" className="text-primary-hover"> *</span>
          <Input.TextArea id="refund-reason" required aria-required="true" rows={3} maxLength={500} showCount
            value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder={t("sales.refundReasonPlaceholder")} aria-describedby="refund-reason-hint" className="mt-1.5" />
          <span id="refund-reason-hint" className="mt-1 block text-xs font-normal text-muted">{t("sales.refundReasonHint")}</span>
        </label>}
        {settle.error && <Alert role="alert" type="error" showIcon className="mt-3"
          title={settle.error instanceof ApiError ? settle.error.message : t("eventWorkflow.networkError")} />}
      </Modal>
    </section>
  );
};

const SalesBreakdown = ({ summary, t, locale }: { summary: EventSummary; t: TFunction; locale: string }) => {
  const count = new Intl.NumberFormat(locale);
  const inventory = [
    ["sales.available", summary.tickets_remaining],
    ["sales.reserved", summary.tickets_reserved],
    ["sales.sold", summary.tickets_sold, summary.capacity],
    ["sales.refunded", summary.tickets_refunded],
    ["sales.checkedIn", summary.attendance.checked_in, summary.attendance.registered],
  ] as const;
  const amounts = [
    ["sales.gross", summary.gross_minor],
    ["sales.fees", summary.fees_minor],
    ["sales.refunds", summary.refunds_minor],
    ["sales.payout", summary.estimated_payout_minor],
  ] as const;

  return <>
    <h3 className="text-sm font-semibold">{t("sales.inventory")}</h3>
    <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {inventory.map(([label, value, total]) => <div key={label}>
        <dt className="text-xs text-muted">{t(label)}</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums">{count.format(value)}{total !== undefined && ` / ${count.format(total)}`}</dd>
      </div>)}
    </dl>
    <div className="mt-5 border-t border-line-soft pt-4">
      <h3 className="text-sm font-semibold">{t(summary.is_simulated ? "sales.simulatedBreakdown" : "sales.breakdown")}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {amounts.map(([label, value]) => <div key={label}>
          <dt className="text-xs text-muted">{t(label)}</dt>
          <dd className="mt-1 break-words text-lg font-semibold tabular-nums">{formatMinor(value, locale)}</dd>
        </div>)}
      </dl>
    </div>
  </>;
};
