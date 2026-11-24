import { Button, Input, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { AdminRecordEventLink, AdminRecordNavigation, AdminRecords, AdminRecordTime } from "../features/Operations/ui/AdminRecords";
import { OperationsWorkspace } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi } from "../shared/api/admin";
import type { AdminActivationRecord, AdminCampaign } from "../shared/api/admin";
import { formatMinor } from "../shared/lib/formatPrice";
import { FileDownloadButton } from "../shared/ui/FileDownloadButton";

const activationLabels = {
  pending: "ops.activationPending", active: "ops.activationActive", suspended: "ops.activationSuspended",
} as const;
const activationStatuses = ["pending", "active", "suspended"] as const;
const selectClass = "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

/** Keeps a filter in the URL so it survives refreshes and shared links; resets paging. */
const useUrlFilter = () => {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    if (next.toString() !== params.toString()) setParams(next);
  };
  return [params, set] as const;
};

export const AdminSalesPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const tab = params.get("view") === "campaigns" ? "campaigns" : "activations";
  const userId = me.data?.is_platform_admin ? me.data.id : undefined;
  if (userId === undefined) return null;

  return <OperationsWorkspace admin>
    <h1 className="page-title">{t("adminSales.title")}</h1>
    <AdminRecordNavigation label={t("adminSales.title")} current={tab} links={[
      { id: "activations", to: "/admin/sales", label: t("adminSales.activations") },
      { id: "campaigns", to: "/admin/sales?view=campaigns", label: t("campaigns.title") },
    ]} />
    {tab === "campaigns" ? <AdminCampaigns userId={userId} /> : <AdminActivations userId={userId} />}
  </OperationsWorkspace>;
};

const AdminActivations = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setFilter] = useUrlFilter();
  const status = activationStatuses.find((value) => value === params.get("status"));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <AdminRecords<AdminActivationRecord> title={t("adminSales.activations")} empty={t("adminSales.noActivations")}
    queryKey={[...operationsKeys.adminRecords(userId, "activations"), status]}
    load={(page) => adminApi.activations(page, status)} rowKey={(row) => row.event_id}
    actions={<div>
      <FileDownloadButton filename="biletflow-activations.csv" label={t("adminFinance.exportActivations")}
        getFile={() => adminApi.exportCsv("activations", { status })} />
      <p className="mt-1 text-xs text-muted">{t("adminFinance.exportScope")}</p>
    </div>}
    filters={<div className="my-4 w-full max-w-56">
      <label htmlFor="admin-activation-status" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
      <select id="admin-activation-status" value={status ?? ""} className={selectClass}
        onChange={(event) => setFilter({ status: event.target.value })}>
        <option value="">{t("support.anyStatus")}</option>
        {activationStatuses.map((value) => <option key={value} value={value}>{t(activationLabels[value])}</option>)}
      </select>
    </div>}
    columns={[
      { label: t("adminFinance.event"), cell: (row) => <AdminRecordEventLink id={row.event_id} title={row.event_title} /> },
      { label: t("support.statusLabel"), cell: (row) => <Tag color={row.status === "active" ? "green" : row.status === "suspended" ? "orange" : "default"}>
        {t(activationLabels[row.status])}</Tag> },
      { label: t("ops.activationFee"), cell: (row) => <>
        <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinor(row.activation_fee_minor, locale)}</span>
        <span className="mt-1 block text-xs text-muted">{t(row.fee_paid ? "ops.checkFee" : "adminSales.feeUnpaid")}</span>
      </> },
      { label: t("ops.activatedAt"), cell: (row) => row.activated_at
        ? <AdminRecordTime value={row.activated_at} format={date} /> : t("ops.notYet") },
      { label: t("ops.suspensionReason"), cell: (row) => row.suspension_reason ?? "—" },
    ]} />;
};

const AdminCampaigns = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setFilter] = useUrlFilter();
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const stateParam = params.get("state");
  const active = stateParam === "enabled" ? true : stateParam === "disabled" ? false : undefined;
  const number = new Intl.NumberFormat(locale);

  return <AdminRecords<AdminCampaign> title={t("campaigns.title")} empty={t("campaigns.empty")}
    queryKey={[...operationsKeys.adminRecords(userId, "campaigns"), query, active ?? null]}
    load={(page) => adminApi.campaigns(page, query, active)} rowKey={(row) => row.id}
    filters={<form key={`${query}|${stateParam ?? ""}`} className="my-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setFilter({ q: String(fields.get("q") ?? "").trim(), state: String(fields.get("state") ?? "") });
    }}>
      <div className="min-w-0 flex-1 basis-64">
        <label htmlFor="admin-campaign-search" className="mb-1.5 block text-sm font-semibold">{t("adminSales.searchCampaigns")}</label>
        <Input id="admin-campaign-search" type="search" name="q" maxLength={100} defaultValue={query} />
      </div>
      <div>
        <label htmlFor="admin-campaign-state" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
        <select id="admin-campaign-state" name="state" defaultValue={active === undefined ? "" : stateParam ?? ""} className={selectClass}>
          <option value="">{t("support.anyStatus")}</option>
          <option value="enabled">{t("campaigns.enabled")}</option>
          <option value="disabled">{t("campaigns.disabled")}</option>
        </select>
      </div>
      <Button htmlType="submit" type="primary">{t("ops.search")}</Button>
    </form>}
    columns={[
      { label: t("campaigns.name"), cell: (row) => <>{row.name}<span className="mt-1 block font-mono text-xs text-muted">{row.code}</span></> },
      { label: t("adminFinance.event"), cell: (row) => <AdminRecordEventLink id={row.event_id} title={row.event_title} /> },
      { label: t("support.statusLabel"), cell: (row) => <Tag color={row.is_active ? "green" : "default"}>
        {t(row.is_active ? "campaigns.enabled" : "campaigns.disabled")}</Tag> },
      { label: t("campaigns.redemptions"), cell: (row) => number.format(row.redemptions) },
      { label: t("campaigns.orders"), cell: (row) => number.format(row.orders) },
      { label: t("adminSales.totalDiscount"), cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatMinor(row.discount_minor, locale)}</span> },
      { label: t("campaigns.net"), cell: (row) => <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinor(row.net_minor, locale)}</span> },
    ]} />;
};
