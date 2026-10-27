import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { CheckCircle2, CircleAlert, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import { activationApi } from "../../../shared/api/eventManagement";
import type { Activation, Checklist } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";

const ITEMS: (keyof Checklist)[] = [
  "paid_ticket_type", "organizer_verified", "payout_account_active", "terms_accepted", "fee_paid",
];

// §3.2 / §4.5: the activation checklist for selling paid tickets on this one
// event. Everything money-related is a labelled simulation (§4.6).
export const ActivationPanel = ({ eventId }: { eventId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const queryKey = ["organizer", "activation", eventId];
  const activation = useQuery({ queryKey, queryFn: () => activationApi.get(eventId) });
  const step = useMutation({
    mutationFn: (run: () => Promise<Activation>) => run(),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  if (!activation.data) return null;
  const { status, checklist, activation_fee_minor } = activation.data;
  const complete = ITEMS.every((item) => checklist[item]);

  return (
    <section aria-labelledby="activation" className="rounded-xl border border-[#D0D5DD] bg-white p-5">
      <h2 id="activation" className="flex items-center gap-2 font-semibold"><Wallet size={18} aria-hidden="true" />{t("activation.title")}</h2>
      <p className="mt-1 text-xs text-[#667085]">{t("activation.description")}</p>
      <p className="mt-3 inline-block rounded-full border border-[#D0D5DD] px-3 py-1 text-xs font-semibold">
        {t(`activation.status.${status}`)}
      </p>
      <ul className="mt-4 space-y-2">
        {ITEMS.map((item) => <li key={item} className="flex gap-2 text-sm">
          {checklist[item] ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
            : <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#A93216]" aria-hidden="true" />}
          <span><span className="sr-only">{t(checklist[item] ? "eventWorkflow.met" : "eventWorkflow.unmet")}: </span>
            {t(`activation.item.${item}`)}</span>
        </li>)}
      </ul>
      {status === "pending" && <div className="mt-4 flex flex-wrap gap-2">
        {(!checklist.organizer_verified || !checklist.payout_account_active) &&
          <Link to="/organizer/profile" className="text-sm font-semibold text-[#A93216]">{t("activation.openProfile")}</Link>}
        {!checklist.terms_accepted && <Button loading={step.isPending}
          onClick={() => step.mutate(() => activationApi.acceptTerms(eventId))}>{t("activation.acceptTerms")}</Button>}
        {!checklist.fee_paid && <Button loading={step.isPending}
          onClick={() => step.mutate(() => activationApi.payFee(eventId, "succeed"))}>
          {t("activation.payFee", { amount: formatMinor(activation_fee_minor, locale) })}
        </Button>}
        <Button type="primary" disabled={!complete} loading={step.isPending}
          onClick={() => step.mutate(() => activationApi.activate(eventId))}>{t("activation.activate")}</Button>
      </div>}
      {status === "suspended" && <Alert type="warning" showIcon className="mt-4" title={t("activation.suspended")}
        description={activation.data.suspension_reason} />}
      <p className="mt-4 text-xs text-[#667085]">{t("activation.simulated")}</p>
      {step.error && <Alert role="alert" type="error" showIcon className="mt-3"
        title={step.error instanceof ApiError ? step.error.message : t("eventWorkflow.networkError")} />}
    </section>
  );
};
