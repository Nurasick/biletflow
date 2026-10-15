import { ConfigProvider } from "antd";
import { ArrowLeft, BadgeCheck, CalendarDays, CalendarPlus, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";

import { LanguageSwitcher } from "../../../i18n/LanguageSwitcher";

export const OrganizerWorkspace = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const links = [
    { to: "/organizer/events", label: t("eventWorkflow.myEvents"), Icon: CalendarDays, end: true },
    { to: "/organizer/events/new", label: t("nav.createEvent"), Icon: CalendarPlus },
    { to: "/organizer/profile", label: t("organizer.profile"), Icon: UserRound },
  ];

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: "#FF5C35", colorText: "#101828", colorBgContainer: "#F5F5F0",
        colorBorder: "#D0D5DD", borderRadius: 9, controlHeight: 44, fontSize: 13,
      },
      components: { Button: { primaryColor: "#101828" } },
    }}>
      <div className="min-h-screen bg-[#F5F5F0] text-[#101828]">
        <header className="border-b border-[#D0D5DD] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-8">
            <Link to="/" aria-label={t("common.home")} className="text-2xl font-bold tracking-tight">
              Bilet<span className="text-[#FF5C35]">Flow</span>
            </Link>
            <LanguageSwitcher />
            <span className="rounded-full border border-[#D0D5DD] px-3 py-1.5 text-xs text-[#667085]">{t("organizer.workspace")}</span>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:py-10">
          <aside>
            <Link to="/" className="flex items-center gap-2 text-xs text-[#667085]">
              <ArrowLeft size={14} aria-hidden="true" />{t("common.backToEvents")}
            </Link>
            <nav aria-label={t("organizer.navigation")} className="mt-6 flex flex-wrap gap-2 lg:flex-col">
              {links.map(({ to, label, Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold ${isActive
                    ? "bg-[#FF5C35]/10 text-[#A93216]" : "text-[#667085] hover:bg-white"}`}>
                  <Icon size={18} aria-hidden="true" />{label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-6 hidden rounded-xl border border-[#D0D5DD] p-4 lg:block">
              <BadgeCheck size={20} className="text-[#667085]" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold">{t("organizer.contactTitle")}</p>
              <p className="mt-2 text-xs leading-5 text-[#667085]">{t("organizer.contactDescription")}</p>
            </div>
          </aside>
          <main className="min-w-0 max-w-4xl">{children}</main>
        </div>
      </div>
    </ConfigProvider>
  );
};
