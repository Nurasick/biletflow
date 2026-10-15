import { useTranslation } from "react-i18next";
import { Alert, Button, ConfigProvider } from "antd";
import { ArrowLeft, BadgeCheck, LoaderCircle, UserRound } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";

import { useOrganizerProfile } from "../features/Organizer/model/useOrganizerProfile";
import { OrganizerProfileForm } from "../features/Organizer/ui/OrganizerProfileForm";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";

export const OrganizerProfilePage = () => {
  const { t } = useTranslation();
  const { userId } = useOutletContext<{ userId: number }>();
  const { profile, saveProfile } = useOrganizerProfile(userId);

  return (
    <ConfigProvider theme={{ token: {
      colorPrimary: "#FF5C35", colorText: "#101828", colorBgContainer: "#F5F5F0",
      colorBorder: "#D0D5DD", borderRadius: 9, controlHeight: 44, fontSize: 13,
    }, components: { Button: { primaryColor: "#101828" } } }}>
      <div className="min-h-screen bg-[#F5F5F0] text-[#101828]">
        <header className="border-b border-[#D0D5DD] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-8">
            <Link to="/" aria-label={t("common.home")} className="text-2xl font-bold tracking-tight">Bilet<span className="text-[#FF5C35]">Flow</span></Link>
            <LanguageSwitcher />
            <span className="rounded-full border border-[#D0D5DD] px-3 py-1.5 text-xs text-[#667085]">{t("organizer.workspace")}</span>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:py-10">
          <aside>
            <Link to="/" className="flex items-center gap-2 text-xs text-[#667085]"><ArrowLeft size={14} aria-hidden="true" />{t("common.backToEvents")}</Link>
            <nav aria-label={t("organizer.navigation")} className="mt-6">
              <Link to="/organizer/profile" aria-current="page" className="flex items-center gap-3 rounded-lg bg-[#FF5C35]/10 px-4 py-3 text-sm font-semibold text-[#A93216]">
                <UserRound size={18} aria-hidden="true" />{t("organizer.profile")}
              </Link>
            </nav>
            <div className="mt-6 hidden rounded-xl border border-[#D0D5DD] p-4 lg:block">
              <BadgeCheck size={20} className="text-[#667085]" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold">{t("organizer.contactTitle")}</p>
              <p className="mt-2 text-xs leading-5 text-[#667085]">{t("organizer.contactDescription")}</p>
            </div>
          </aside>
          <main className="min-w-0 max-w-4xl">
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">{t("organizer.yourOrganization")}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{t("organizer.profile")}</h1>
            <p className="mt-2 text-sm leading-6 text-[#667085]">{t("organizer.profileDescription")}</p>
            <div className="my-6 rounded-lg border border-[#D0D5DD] px-4 py-3 text-xs leading-5 text-[#667085]">
              <span className="font-semibold text-[#101828]">{t("organizer.demoWorkspace")}</span> {t("organizer.demoDescription")}
            </div>
            {profile.isPending ? (
              <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white py-20 text-sm text-[#667085]">
                <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} aria-hidden="true" />{t("organizer.loading")}
              </div>
            ) : profile.isError ? (
              <Alert role="alert" type="error" showIcon title={t("organizer.loadError")} description={profile.error.message}
                action={<Button onClick={() => void profile.refetch()} loading={profile.isFetching}>{t("common.retry")}</Button>} />
            ) : (
              <OrganizerProfileForm profile={profile.data} saveProfile={saveProfile.mutateAsync} />
            )}
            <p className="mt-8 text-xs text-[#667085]">{t("organizer.required")}</p>
          </main>
        </div>
      </div>
    </ConfigProvider>
  );
};
