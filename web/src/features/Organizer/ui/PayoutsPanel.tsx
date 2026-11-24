import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { organizerApi } from "../../../shared/api/organizer";
import type { Payout } from "../../../shared/api/organizer";
import { formatMinorCurrency } from "../../../shared/lib/formatPrice";
import { organizerProfileKeys } from "../model/useOrganizerProfile";
import { ReportError, ReportLoading, ReportRefresh } from "./ReportControls";

const payoutTone: Record<Payout["status"], string> = {
  pending: "bg-soft text-muted-strong", processing: "bg-[#FFFAEB] text-[#B54708]",
  paid: "bg-[#ECFDF3] text-[#027A48]", failed: "bg-[#FEF3F2] text-[#B42318]",
};

// §4.10: the payout account the platform would settle to, and the simulated
// settlements made for this organizer's events.
export const PayoutsPanel = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const record = useQuery({ queryKey: organizerProfileKeys.record(userId), queryFn: organizerApi.getRecord, retry: false });
  const payouts = useQuery({
    queryKey: ["organizer", "payouts", userId], queryFn: ({ signal }) => organizerApi.payouts(signal), retry: false,
  });
  if (!record.data) return null;
  const account = record.data.payout_account;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <section aria-labelledby="payouts" className="mt-6 rounded-xl border border-line bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="payouts" className="flex items-center gap-2 font-semibold"><Landmark size={18} aria-hidden="true" />{t("organizer.payoutsTitle")}</h2>
      <ReportRefresh refresh={() => void payouts.refetch()} fetching={payouts.isFetching} />
    </div>
    <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
      {account ? <p>
        <span className="font-semibold">{t(account.provider === "sandbox_bank" ? "organizer.demoBank" : "organizer.demoWallet")}</span>
        {" · "}<span className="font-mono text-xs">{account.external_account_ref}</span>
        {" · "}{t(`organizer.payoutAccountStatus.${account.status}`)}
      </p> : <p className="text-muted">{t("organizer.payoutAccountMissing")}</p>}
    </div>
    <h3 className="mt-5 text-sm font-semibold">{t("organizer.payoutHistory")}</h3>
    <div aria-busy={payouts.isFetching}>
      {payouts.isPending ? <ReportLoading /> : payouts.isError
        ? <div className="mt-2"><ReportError error={payouts.error} retry={() => void payouts.refetch()} fetching={payouts.isFetching} /></div>
        : payouts.data.length === 0 ? <p className="mt-2 text-sm text-muted">{t("organizer.payoutsEmpty")}</p>
          : <ul className="mt-2 divide-y divide-line-soft">
            {payouts.data.map((payout) => <li key={payout.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="break-words font-semibold">{payout.event_title}</p>
                <p className="mt-1 text-xs text-muted">
                  {date.format(new Date(payout.paid_at ?? payout.created_at))}
                  {payout.reference && <> · <span className="font-mono">{payout.reference}</span></>}
                  {payout.is_simulated && ` · ${t("organizer.payoutSimulated")}`}
                </p>
                {payout.status === "failed" && payout.failure_reason && <p className="mt-1 text-xs text-[#B42318]">{payout.failure_reason}</p>}
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{formatMinorCurrency(payout.amount_minor, payout.currency, locale)}</p>
                <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${payoutTone[payout.status]}`}>
                  {t(`organizer.payoutStatus.${payout.status}`)}
                </span>
              </div>
            </li>)}
          </ul>}
    </div>
  </section>;
};
