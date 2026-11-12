import { Tag } from "antd";
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

const activationLabels = {
  pending: "ops.activationPending", active: "ops.activationActive", suspended: "ops.activationSuspended",
} as const;

export const AdminSalesPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const tab = params.get("view") === "campaigns" ? "campaigns" : "activations";
  const userId = me.data?.is_platform_admin ? me.data.id : undefined;
  if (userId === undefined) return null;

  return <OperationsWorkspace admin>
    <h1 className="text-3xl font-bold tracking-tight">{t("adminSales.title")}</h1>
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
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <AdminRecords<AdminActivationRecord> title={t("adminSales.activations")} empty={t("adminSales.noActivations")}
    queryKey={operationsKeys.adminRecords(userId, "activations")} load={adminApi.activations} rowKey={(row) => row.event_id}
    columns={[
      { label: t("adminFinance.event"), cell: (row) => <AdminRecordEventLink id={row.event_id} title={row.event_title} /> },
      { label: t("support.statusLabel"), cell: (row) => <Tag color={row.status === "active" ? "green" : row.status === "suspended" ? "orange" : "default"}>
        {t(activationLabels[row.status])}</Tag> },
      { label: t("ops.activationFee"), cell: (row) => <>
        <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinor(row.activation_fee_minor, locale)}</span>
        <span className="mt-1 block text-xs text-[#667085]">{t(row.fee_paid ? "ops.checkFee" : "adminSales.feeUnpaid")}</span>
      </> },
      { label: t("ops.activatedAt"), cell: (row) => row.activated_at
        ? <AdminRecordTime value={row.activated_at} format={date} /> : t("ops.notYet") },
      { label: t("ops.suspensionReason"), cell: (row) => row.suspension_reason ?? "—" },
    ]} />;
};

const AdminCampaigns = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);

  return <AdminRecords<AdminCampaign> title={t("campaigns.title")} empty={t("campaigns.empty")}
    queryKey={operationsKeys.adminRecords(userId, "campaigns")} load={adminApi.campaigns} rowKey={(row) => row.id}
    columns={[
      { label: t("campaigns.name"), cell: (row) => <>{row.name}<span className="mt-1 block font-mono text-xs text-[#667085]">{row.code}</span></> },
      { label: t("adminFinance.event"), cell: (row) => <AdminRecordEventLink id={row.event_id} title={row.event_title} /> },
      { label: t("support.statusLabel"), cell: (row) => <Tag color={row.is_active ? "green" : "default"}>
        {t(row.is_active ? "campaigns.enabled" : "campaigns.disabled")}</Tag> },
      { label: t("campaigns.redemptions"), cell: (row) => number.format(row.redemptions) },
      { label: t("campaigns.orders"), cell: (row) => number.format(row.orders) },
      { label: t("adminSales.totalDiscount"), cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatMinor(row.discount_minor, locale)}</span> },
      { label: t("campaigns.net"), cell: (row) => <span className="whitespace-nowrap font-semibold tabular-nums">{formatMinor(row.net_minor, locale)}</span> },
    ]} />;
};
