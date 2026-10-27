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
  const verified = record.data.verification_status === "verified";

  return (
    <section aria-labelledby="verification" className="mt-6 rounded-xl border border-[#D0D5DD] bg-white p-5">
      <h2 id="verification" className="flex items-center gap-2 font-semibold">
        <ShieldCheck size={18} aria-hidden="true" className={verified ? "text-green-700" : "text-[#667085]"} />
        {t("organizer.verification")}
      </h2>
      <p className="mt-2 text-sm text-[#667085]">
        {t(verified ? "organizer.verified" : "organizer.notVerified")}
      </p>
      {!verified && <Button className="mt-4" loading={verify.isPending} onClick={() => verify.mutate()}>
        {t("organizer.verifySimulated")}
      </Button>}
      {verify.isError && <p role="alert" className="mt-2 text-sm text-[#A93216]">{t("organizer.saveError")}</p>}
    </section>
  );
};
