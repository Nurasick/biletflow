import { useTranslation } from "react-i18next";
import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { useOrganizerProfile } from "../features/Organizer/model/useOrganizerProfile";
import { OrganizerProfileForm } from "../features/Organizer/ui/OrganizerProfileForm";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import { VerificationPanel } from "../features/Organizer/ui/VerificationPanel";
import type { OrganizerContext } from "../shared/auth/OrganizerRoute";

export const OrganizerProfilePage = () => {
  const { t } = useTranslation();
  const { userId, email } = useOutletContext<OrganizerContext>();
  const { profile, saveProfile } = useOrganizerProfile(userId, email);

  return (
    <OrganizerWorkspace>
      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted">{t("organizer.yourOrganization")}</p>
      <h1 className="mt-2 page-title">{t("organizer.profile")}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{t("organizer.profileDescription")}</p>
      <div className="my-6 rounded-lg border border-line px-4 py-3 text-xs leading-5 text-muted">
        <span className="font-semibold text-ink">{t("organizer.sandboxTitle")}</span> {t("organizer.sandboxDescription")}
      </div>
      {profile.isPending ? (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-line bg-white py-20 text-sm text-muted">
          <LoaderCircle className="animate-spin text-primary" size={18} aria-hidden="true" />{t("organizer.loading")}
        </div>
      ) : profile.isError ? (
        <Alert role="alert" type="error" showIcon title={t("organizer.loadError")} description={profile.error.message}
          action={<Button onClick={() => void profile.refetch()} loading={profile.isFetching}>{t("common.retry")}</Button>} />
      ) : (
        <>
          <OrganizerProfileForm profile={profile.data} saveProfile={saveProfile.mutateAsync} />
          <VerificationPanel userId={userId} />
        </>
      )}
      <p className="mt-8 text-xs text-muted">{t("organizer.required")}</p>
    </OrganizerWorkspace>
  );
};
