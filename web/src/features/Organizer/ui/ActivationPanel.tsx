import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Modal } from "antd";
import { CheckCircle2, CircleAlert, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import { activationApi } from "../../../shared/api/eventManagement";
import type { Activation, Checklist } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";

const TERMS = ["activation.terms.fee", "activation.terms.payouts", "activation.terms.refunds",
  "activation.terms.suspension", "activation.terms.simulation"] as const;

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
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const step = useMutation({
    mutationFn: (run: () => Promise<Activation>) => run(),
    onSuccess: (data) => { queryClient.setQueryData(queryKey, data); setTermsOpen(false); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const openTerms = () => { step.reset(); setTermsRead(false); setTermsOpen(true); };
  if (!activation.data) return null;
  const { status, checklist, activation_fee_minor } = activation.data;
  const complete = ITEMS.every((item) => checklist[item]);

  return (
    <section aria-labelledby="activation" className="rounded-xl border border-line bg-white p-5">
      <h2 id="activation" className="flex items-center gap-2 font-semibold"><Wallet size={18} aria-hidden="true" />{t("activation.title")}</h2>
      <p className="mt-1 text-xs text-muted">{t("activation.description")}</p>
      <p className="mt-3 inline-block rounded-full border border-line px-3 py-1 text-xs font-semibold">
        {t(`activation.status.${status}`)}
      </p>
      <ul className="mt-4 space-y-2">
        {ITEMS.map((item) => <li key={item} className="flex gap-2 text-sm">
          {checklist[item] ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
            : <CircleAlert size={16} className="mt-0.5 shrink-0 text-primary-hover" aria-hidden="true" />}
          <span><span className="sr-only">{t(checklist[item] ? "eventWorkflow.met" : "eventWorkflow.unmet")}: </span>
            {t(`activation.item.${item}`)}</span>
        </li>)}
      </ul>
      {status === "pending" && <div className="mt-4 flex flex-wrap gap-2">
        {(!checklist.organizer_verified || !checklist.payout_account_active) &&
          <Link to="/organizer/profile" className="text-sm font-semibold text-primary-hover">{t("activation.openProfile")}</Link>}
        {!checklist.terms_accepted && <Button disabled={step.isPending} onClick={openTerms}>{t("activation.reviewTerms")}</Button>}
        {!checklist.fee_paid && <>
          <Button loading={step.isPending}
            onClick={() => step.mutate(() => activationApi.payFee(eventId, "succeed"))}>
            {t("activation.payFee", { amount: formatMinor(activation_fee_minor, locale) })}
          </Button>
          <Button danger disabled={step.isPending}
            onClick={() => step.mutate(() => activationApi.payFee(eventId, "fail"))}>
            {t("activation.simulateFeeFailure")}
          </Button>
        </>}
        <Button type="primary" disabled={!complete} loading={step.isPending}
          onClick={() => step.mutate(() => activationApi.activate(eventId))}>{t("activation.activate")}</Button>
      </div>}
      {status === "suspended" && <Alert type="warning" showIcon className="mt-4" title={t("activation.suspended")}
        description={activation.data.suspension_reason} />}
      <p className="mt-4 text-xs text-muted">{t("activation.simulated")}</p>
      {step.error && !termsOpen && <Alert role="alert" type="error" showIcon className="mt-3"
        title={step.error instanceof ApiError && step.error.status === 402 ? t("activation.feeDeclined")
          : step.error instanceof ApiError ? step.error.message : t("eventWorkflow.networkError")}
        description={step.error instanceof ApiError && step.error.status === 402 ? step.error.message : undefined} />}
      <Modal open={termsOpen} title={t("activation.terms.title")} okText={t("activation.acceptTerms")}
        cancelText={t("activation.terms.cancel")} okButtonProps={{ disabled: !termsRead }} confirmLoading={step.isPending}
        onCancel={() => { if (!step.isPending) setTermsOpen(false); }}
        onOk={() => step.mutate(() => activationApi.acceptTerms(eventId))}>
        <div tabIndex={0} aria-label={t("activation.terms.title")}
          className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-line-soft bg-paper p-4 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-primary">
          <p>{t("activation.terms.intro", { amount: formatMinor(activation_fee_minor, locale) })}</p>
          <ol className="list-decimal space-y-2 pl-5">{TERMS.map((key) => <li key={key}>{t(key)}</li>)}</ol>
        </div>
        <Checkbox className="mt-4" checked={termsRead} onChange={(change) => setTermsRead(change.target.checked)}>
          {t("activation.terms.confirm")}
        </Checkbox>
        {step.error && <Alert role="alert" type="error" showIcon className="mt-3"
          title={step.error instanceof ApiError ? step.error.message : t("eventWorkflow.networkError")} />}
      </Modal>
    </section>
  );
};
