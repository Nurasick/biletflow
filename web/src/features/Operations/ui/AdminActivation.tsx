import { Tag } from "antd";
import { CheckCircle2, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import type { AdminActivation as Activation } from "../../../shared/api/admin";
import { operationsCard } from "./OperationsWorkspace";

const checklistLabels = {
  paid_ticket_type: "ops.checkPaidType", organizer_verified: "ops.checkVerified", fee_paid: "ops.checkFee",
  payout_account_active: "ops.checkPayout", terms_accepted: "ops.checkTerms",
} as const;
const statusLabels = { pending: "ops.activationPending", active: "ops.activationActive", suspended: "ops.activationSuspended" } as const;

export const AdminActivation = ({ activation, timeZone }: { activation: Activation | null; timeZone: string }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone,
  }).format(new Date(value)) : t("ops.notYet");
  return <section className={operationsCard}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{t("ops.activation")}</h2>
      {activation && <Tag color={activation.status === "active" ? "green" : activation.status === "suspended" ? "orange" : "default"}>{t(statusLabels[activation.status])}</Tag>}</div>
    {!activation ? <p className="mt-4 text-sm text-[#667085]">{t("ops.noActivation")}</p> : <>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#667085]">{t("ops.activationFee")}</dt><dd className="font-semibold">{new Intl.NumberFormat(locale, {
          style: "currency", currency: activation.currency,
        }).format(activation.activation_fee_minor / 100)}</dd></div>
        {([['ops.termsAcceptedAt', activation.terms_accepted_at], ['ops.activatedAt', activation.activated_at], ['ops.suspendedAt', activation.suspended_at]] as const).map(([key, value]) => <div key={key} className="flex flex-wrap justify-between gap-2">
          <dt className="text-[#667085]">{t(key)}</dt><dd>{date(value)}</dd>
        </div>)}
      </dl>
      {activation.is_simulated && <p className="mt-3 rounded-lg bg-[#F5F5F0] p-3 text-xs font-semibold text-[#667085]">{t("ops.simulated")}</p>}
      {activation.status === "suspended" && activation.suspension_reason && <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
        <p className="font-semibold">{t("ops.suspensionReason")}</p><p className="mt-1 whitespace-pre-wrap break-words">{activation.suspension_reason}</p>
      </div>}
      <ul className="mt-5 space-y-3">
        {(Object.keys(checklistLabels) as Array<keyof typeof checklistLabels>).map((key) => <li key={key} className="flex items-center gap-3 text-sm">
          {activation.checklist[key] ? <CheckCircle2 size={18} className="shrink-0 text-green-700" aria-hidden="true" /> : <Circle size={18} className="shrink-0 text-[#98A2B3]" aria-hidden="true" />}
          <span>{t(checklistLabels[key])}<span className="sr-only"> — {t(activation.checklist[key] ? "ops.met" : "ops.unmet")}</span></span>
        </li>)}
      </ul>
    </>}
  </section>;
};
