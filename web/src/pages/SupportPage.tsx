import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OperationsError, OperationsLoading, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { SUPPORT_POLL_INTERVAL, supportKeys } from "../features/Support/model/supportModel";
import { CaseRow } from "../features/Support/ui/SupportCaseContent";
import { SupportRequestButton } from "../features/Support/ui/SupportRequestButton";
import { useAuth } from "../hooks/useAuth";
import { requesterCaseHref, supportApi } from "../shared/api/support";

export const SupportPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-7 sm:py-10">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{t("common.help")}</h1>
      {me.data?.is_organizer && <SupportRequestButton target={{ audience: "organizer" }} label={t("support.contactPlatform")} />}
    </div>
    <p className="mt-3 text-sm leading-6 text-[#667085]">{t("support.startFromContext")}</p>
    <Link to="/" className="mt-2 inline-block text-sm font-semibold text-[#A93216] hover:underline">{t("common.backToEvents")}</Link>
    <div className="mt-7">
      {me.isPending ? <OperationsLoading /> : me.isError ? <OperationsError error={me.error} retry={() => void me.refetch()} />
        : me.data ? <MyCases key={me.data.id} userId={me.data.id} /> : <div className="rounded-xl border border-[#D0D5DD] p-5 text-sm">
          <p className="text-[#475467]">{t("support.guestHelp")}</p>
          <Link to="/login" state={{ from: "/support" }} className="mt-2 inline-block font-semibold text-[#A93216] hover:underline">
            {t("common.signIn")}
          </Link>
        </div>}
    </div>
  </main>;
};

const MyCases = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const cases = useQuery({
    queryKey: supportKeys.mine(userId), queryFn: ({ signal }) => supportApi.mine(signal),
    refetchInterval: SUPPORT_POLL_INTERVAL, retry: false,
  });
  return <section aria-labelledby="my-support-cases" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="my-support-cases" className="text-xl font-semibold">{t("support.myCases")}</h2>
      <RefreshButton refresh={() => void cases.refetch()} fetching={cases.isFetching} />
    </div>
    {cases.isPending ? <OperationsLoading /> : cases.isError
      ? <OperationsError error={cases.error} retry={() => void cases.refetch()} /> : cases.data.length === 0
      ? <p className="rounded-xl border border-[#D0D5DD] p-5 text-sm text-[#667085]">{t("support.noCases")}</p>
      : <ul className="space-y-3">
        {cases.data.map((summary) => <CaseRow key={summary.case_number} summary={summary}
          href={requesterCaseHref(summary.case_number, null)} />)}
      </ul>}
  </section>;
};
