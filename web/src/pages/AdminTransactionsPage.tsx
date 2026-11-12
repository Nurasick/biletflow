import { Button, Input, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { AdminRecordEventLink, AdminRecordNavigation, AdminRecords, AdminRecordTime } from "../features/Operations/ui/AdminRecords";
import { OperationsWorkspace } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi, adminOrderStatuses, adminPaymentStatuses } from "../shared/api/admin";
import type { AdminOrder, AdminPayment, AdminPaymentStatus, AdminRefund } from "../shared/api/admin";
import { formatMinorCurrency } from "../shared/lib/formatPrice";
import { FileDownloadButton } from "../shared/ui/FileDownloadButton";

const statusClass = "block min-h-11 w-full rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm";
const secondaryText = "mt-1 block text-xs leading-5 text-[#667085]";

export const AdminTransactionsPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const view = params.get("view");
  const tab = view === "payments" || view === "refunds" ? view : "orders";
  const userId = me.data?.is_platform_admin ? me.data.id : undefined;
  if (userId === undefined) return null;

  return <OperationsWorkspace admin>
    <h1 className="text-3xl font-bold tracking-tight">{t("adminFinance.title")}</h1>
    <AdminRecordNavigation label={t("adminFinance.title")} current={tab} links={[
      { id: "orders", to: "/admin/transactions", label: t("sales.orders") },
      { id: "payments", to: "/admin/transactions?view=payments", label: t("adminFinance.payments") },
      { id: "refunds", to: "/admin/transactions?view=refunds", label: t("adminFinance.refunds") },
    ]} />
    {tab === "orders" && <AdminOrders key={userId} userId={userId} />}
    {tab === "payments" && <AdminPayments userId={userId} />}
    {tab === "refunds" && <AdminRefunds userId={userId} />}
  </OperationsWorkspace>;
};

const TransactionExport = ({ kind }: { kind: "orders" | "payments" }) => {
  const { t } = useTranslation();
  return <div>
    <FileDownloadButton filename={`biletflow-${kind}.csv`}
      label={t(kind === "orders" ? "adminFinance.exportOrders" : "adminFinance.exportPayments")}
      getFile={kind === "orders" ? adminApi.ordersCsv : adminApi.paymentsCsv} />
    <p className="mt-1 text-xs text-[#667085]">{t("adminFinance.exportScope")}</p>
  </div>;
};

const AdminOrders = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const status = adminOrderStatuses.find((value) => value === params.get("status"));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <AdminRecords<AdminOrder> title={t("sales.orders")} empty={t("adminFinance.noOrders")}
    queryKey={[...operationsKeys.adminRecords(userId, "orders"), query, status]}
    load={(page) => adminApi.orders(page, query, status)} rowKey={(row) => row.order_number}
    actions={<TransactionExport kind="orders" />}
    filters={<form className="my-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setQuery(String(fields.get("query") ?? "").trim());
      const next = new URLSearchParams(params);
      const selection = String(fields.get("status") ?? "");
      if (selection) next.set("status", selection); else next.delete("status");
      next.delete("page");
      if (next.toString() !== params.toString()) setParams(next);
    }}>
      <div className="min-w-0 flex-1 basis-64">
        <label htmlFor="admin-order-search" className="mb-1.5 block text-sm font-semibold">{t("adminFinance.searchOrders")}</label>
        <Input id="admin-order-search" type="search" name="query" maxLength={100} defaultValue={query} />
      </div>
      <div>
        <label htmlFor="admin-order-status" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
        <select id="admin-order-status" name="status" key={status ?? ""} defaultValue={status ?? ""} className={statusClass}>
          <option value="">{t("support.anyStatus")}</option>
          {adminOrderStatuses.map((value) => <option key={value} value={value}>{t(`orderStatus.${value}`)}</option>)}
        </select>
      </div>
      <Button htmlType="submit" type="primary">{t("ops.search")}</Button>
    </form>}
    columns={[
      { label: t("reports.order"), cell: (row) => <span className="font-mono text-xs">{row.order_number}</span> },
      { label: t("adminFinance.event"), cell: (row) => <AdminRecordEventLink id={row.event_id} title={row.event_title} /> },
      { label: t("adminFinance.buyer"), cell: (row) => <>{row.contact_name}<span className={secondaryText}>{row.contact_email}</span></> },
      { label: t("support.statusLabel"), cell: (row) => <Tag>{t(`orderStatus.${row.status}`)}</Tag> },
      {
        label: t("adminFinance.total"),
        cell: (row) => <>
          <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinorCurrency(row.total_minor, row.currency, locale)}</span>
          {row.discount_minor > 0 && <span className={secondaryText}>{t("adminFinance.discountAmount", {
            amount: formatMinorCurrency(row.discount_minor, row.currency, locale),
          })}</span>}
        </>,
      },
      { label: t("ops.created"), cell: (row) => <AdminRecordTime value={row.created_at} format={date} /> },
    ]} />;
};

const PaymentStatus = ({ status }: { status: AdminPaymentStatus }) => {
  const { t } = useTranslation();
  const colors = { pending: "gold", succeeded: "green", failed: "red", refunded: "default" };
  return <Tag color={colors[status]}>{t(`adminFinance.paymentStatus.${status}`)}</Tag>;
};

const AdminPayments = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const status = adminPaymentStatuses.find((value) => value === params.get("status"));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <AdminRecords<AdminPayment> title={t("adminFinance.payments")} empty={t("adminFinance.noPayments")}
    queryKey={[...operationsKeys.adminRecords(userId, "payments"), status]}
    load={(page) => adminApi.payments(page, status)} rowKey={(row) => row.id}
    actions={<TransactionExport kind="payments" />}
    filters={<div className="my-4 w-full max-w-56">
      <label htmlFor="admin-payment-status" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
      <select id="admin-payment-status" value={status ?? ""} className={statusClass}
        onChange={(event) => {
          const next = new URLSearchParams(params);
          if (event.target.value) next.set("status", event.target.value); else next.delete("status");
          next.delete("page");
          setParams(next);
        }}>
        <option value="">{t("support.anyStatus")}</option>
        {adminPaymentStatuses.map((value) => <option key={value} value={value}>{t(`adminFinance.paymentStatus.${value}`)}</option>)}
      </select>
    </div>}
    columns={[
      {
        label: t("adminFinance.payment"),
        cell: (row) => <>#{row.id}<span className={secondaryText}>{t(`adminFinance.purpose.${row.purpose}`)}</span></>,
      },
      {
        label: t("adminFinance.related"),
        cell: (row) => <>
          {row.order_number && <span className="block font-mono text-xs">{row.order_number}</span>}
          {row.event_id !== null && <AdminRecordEventLink id={row.event_id} />}
          {!row.order_number && row.event_id === null && "—"}
        </>,
      },
      {
        label: t("support.statusLabel"),
        cell: (row) => <><PaymentStatus status={row.status} />{row.failure_reason && <span className={secondaryText}>{row.failure_reason}</span>}</>,
      },
      {
        label: t("adminFinance.amount"),
        cell: (row) => <>
          <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinorCurrency(row.amount_minor, row.currency, locale)}</span>
          {row.is_simulated && <span className={secondaryText}>{t("adminFinance.simulated")}</span>}
        </>,
      },
      {
        label: t("adminFinance.provider"),
        cell: (row) => <>{row.provider}{row.provider_ref && <span className={secondaryText}>{row.provider_ref}</span>}</>,
      },
      { label: t("ops.created"), cell: (row) => <AdminRecordTime value={row.created_at} format={date} /> },
    ]} />;
};

const AdminRefunds = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <AdminRecords<AdminRefund> title={t("adminFinance.refunds")} empty={t("adminFinance.noRefunds")}
    queryKey={operationsKeys.adminRecords(userId, "refunds")} load={adminApi.refunds} rowKey={(row) => row.id}
    columns={[
      { label: t("adminFinance.refund"), cell: (row) => <>#{row.id}</> },
      { label: t("reports.order"), cell: (row) => <><span className="block font-mono text-xs">{row.order_number}</span>
        <AdminRecordEventLink id={row.event_id} /></> },
      { label: t("support.statusLabel"), cell: (row) => <PaymentStatus status={row.status} /> },
      { label: t("adminFinance.amount"), cell: (row) => <span className="whitespace-nowrap font-semibold tabular-nums">
        {formatMinorCurrency(row.amount_minor, row.currency, locale)}</span> },
      { label: t("ops.reason"), cell: (row) => row.reason },
      { label: t("ops.created"), cell: (row) => <AdminRecordTime value={row.created_at} format={date} /> },
    ]} />;
};
