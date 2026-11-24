import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { organizerApi } from "../../../shared/api/organizer";
import { organizerProfileKeys } from "../model/useOrganizerProfile";

// §3.2 step 2. Real identity checks are out of the MVP (§8), so this is a
// labelled simulation that the backend accepts at once.
export const VerificationPanel = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = organizerProfileKeys.record(userId);
  const record = useQuery({ queryKey, queryFn: organizerApi.getRecord, retry: false });
  const verify = useMutation({
    mutationFn: organizerApi.verify,
    onSuccess: (profile) => queryClient.setQueryData(queryKey, profile),
  });
  if (!record.data) return null;
  const status = record.data.verification_status;
  const verified = status === "verified";
  const tone = { verified: "bg-[#ECFDF3] text-[#027A48]", pending: "bg-[#FFFAEB] text-[#B54708]",
    rejected: "bg-[#FEF3F2] text-[#B42318]", unverified: "bg-soft text-muted-strong" }[status];

  return (
    <section aria-labelledby="verification" className="mt-6 rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="verification" className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} aria-hidden="true" className={verified ? "text-green-700" : "text-muted"} />
          {t("organizer.verification")}
        </h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{t(`organizer.verificationStatus.${status}`)}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{t(`organizer.verificationHint.${status}`)}</p>
      {record.data.verification_is_simulated && <p className="mt-1 text-xs text-muted">{t("organizer.verificationSimulated")}</p>}
      {(status === "unverified" || status === "rejected") && <Button className="mt-4" loading={verify.isPending} onClick={() => verify.mutate()}>
        {t(status === "rejected" ? "organizer.verifyAgain" : "organizer.verifySimulated")}
      </Button>}
      {verify.isError && <p role="alert" className="mt-2 text-sm text-primary-hover">{t("organizer.saveError")}</p>}
    </section>
  );
};
