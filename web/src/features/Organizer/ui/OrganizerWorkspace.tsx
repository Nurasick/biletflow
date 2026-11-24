import { ArrowLeft, BarChart3, CalendarDays, CalendarPlus, LifeBuoy, MessageCircle, ScanLine, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useOutletContext } from "react-router-dom";

import { LanguageSwitcher } from "../../../i18n/LanguageSwitcher";
import type { OrganizerContext } from "../../../shared/auth/OrganizerRoute";
import { Brand } from "../../../shared/ui/Brand";
import { NotificationLink } from "../../Notifications/ui/NotificationLink";

export const OrganizerWorkspace = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const { userId, isOrganizer } = useOutletContext<OrganizerContext>();
  const links = [
    { to: "/organizer/events", label: t("eventWorkflow.myEvents"), Icon: CalendarDays, end: true },
    { to: "/organizer/events/new", label: t("nav.createEvent"), Icon: CalendarPlus },
    { to: "/organizer/analytics", label: t("analytics.overviewTitle"), Icon: BarChart3 },
    { to: "/organizer/profile", label: t("organizer.profile"), Icon: UserRound },
    { to: "/staff/events", label: t("nav.checkIn"), Icon: ScanLine },
    ...(isOrganizer ? [{ to: "/staff/support", label: t("support.queue"), Icon: MessageCircle }] : []),
    { to: "/support", label: t("common.help"), Icon: LifeBuoy },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="site-container flex min-h-[72px] flex-wrap items-center justify-between gap-3 py-3">
          <Brand />
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <NotificationLink userId={userId} />
          </div>
        </div>
      </header>
      <div className="site-container grid items-start gap-6 py-6 lg:grid-cols-[225px_minmax(0,1fr)] lg:gap-9 lg:py-10">
        <aside className="panel p-3 lg:sticky lg:top-6">
          <Link to="/" className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted hover:text-primary">
            <ArrowLeft size={16} aria-hidden="true" />{t("common.backToEvents")}
          </Link>
          <p className="mx-2 mt-2 border-t border-line-soft pt-3 text-xs font-bold text-muted">{t("organizer.workspace")}</p>
          <nav aria-label={t("organizer.navigation")} className="mt-2 flex flex-wrap gap-1 lg:flex-col">
            {links.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) =>
                `flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-semibold ${isActive
                  ? "bg-accent-wash text-primary" : "text-muted-strong hover:bg-soft hover:text-ink"}`}>
                <Icon size={18} className="shrink-0" aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
};
