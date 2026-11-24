import { CalendarPlus, Menu, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";

import { NotificationLink } from "../../../../features/Notifications/ui/NotificationLink";
import { useAuth } from "../../../../hooks/useAuth";
import { LanguageSwitcher } from "../../../../i18n/LanguageSwitcher";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import { Brand } from "../../../ui/Brand";

/** The phone menu is a <details>; this adds the dismissal a menu needs:
 * Escape closes it and returns focus to its button, a click outside closes it. */
const useDismissibleMenu = () => {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (restoreFocus: boolean) => {
      menu.current?.removeAttribute("open");
      if (restoreFocus) menu.current?.querySelector("summary")?.focus();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    const onPointer = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return { menu, onToggle: () => setOpen(Boolean(menu.current?.open)) };
};

export const Header = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const user = me.data;
  const { canCheckIn, canHandleSupport } = useStaffAccess(user);
  const { menu, onToggle } = useDismissibleMenu();

  return (
    <header className="border-b border-line bg-white">
      <div className="site-container flex min-h-[72px] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Brand />
        <nav className="mr-auto hidden items-center gap-5 text-sm font-semibold text-muted md:flex" aria-label={t("a11y.mainNavigation")}>
          <NavLink end to="/" className={({ isActive }) => isActive ? "text-primary" : "hover:text-ink"}>{t("catalogue.title")}</NavLink>
          <Link to="/support" className="hover:text-ink">{t("common.help")}</Link>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
          <LanguageSwitcher compact />
          {user && <NotificationLink userId={user.id} />}
          {me.isPending ? (
            <span role="status" className="hidden text-xs text-muted sm:inline">{t("nav.checkingSession")}</span>
          ) : me.isError ? (
            <button type="button" onClick={() => void me.refetch()} className="text-sm font-semibold text-primary">{t("nav.retrySession")}</button>
          ) : user ? (
            <Link to="/account" className="action-button min-h-10 gap-2 px-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-wash text-xs font-bold text-primary" aria-hidden="true">
                {user.first_name.slice(0, 1)}{user.last_name.slice(0, 1)}
              </span>
              <span className="hidden max-w-28 truncate lg:block">{user.first_name} {user.last_name}</span>
              <span className="sr-only">{t("nav.account")}</span>
            </Link>
          ) : (
            <Link to="/login" className="action-button min-h-10 px-2.5 sm:px-3.5">
              <UserRound size={16} className="hidden sm:block" aria-hidden="true" />{t("common.signIn")}
            </Link>
          )}
          <Link to="/organizer/events/new" className="action-button action-button--primary hidden md:inline-flex">
            <CalendarPlus size={17} aria-hidden="true" />{t("nav.createEvent")}
          </Link>
          <details ref={menu} onToggle={onToggle} className="group relative md:hidden">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-xl border border-line text-muted-strong [&::-webkit-details-marker]:hidden">
              <Menu size={19} aria-hidden="true" /><span className="sr-only">{t("a11y.openMenu")}</span>
            </summary>
            <nav aria-label={t("a11y.mobileNavigation")} className="panel absolute right-0 z-20 mt-2 grid w-52 gap-1 p-2 text-sm font-semibold"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) event.currentTarget.closest("details")?.removeAttribute("open");
              }}>
              <Link to="/" className="rounded-lg px-3 py-3 hover:bg-soft">{t("catalogue.title")}</Link>
              <Link to="/organizer/events/new" className="rounded-lg px-3 py-3 text-primary hover:bg-accent-wash">{t("nav.createEvent")}</Link>
              <Link to="/support" className="rounded-lg px-3 py-3 hover:bg-soft">{t("common.help")}</Link>
            </nav>
          </details>
        </div>
      </div>

      {user && (canCheckIn || canHandleSupport) && (
        <div className="border-t border-line-soft bg-paper">
          <nav className="site-container flex flex-wrap items-center gap-x-5 gap-y-2 py-3 text-xs font-semibold text-muted-strong" aria-label={t("nav.account")}>
            {user.is_organizer && <Link to="/organizer/events" className="hover:text-primary">{t("eventWorkflow.myEvents")}</Link>}
            {canCheckIn && <Link to="/staff/events" className="hover:text-primary">{t("nav.checkIn")}</Link>}
            {canHandleSupport && <Link to="/staff/support" className="hover:text-primary">{t("support.queue")}</Link>}
            {user.is_platform_admin && <Link to="/admin" className="hover:text-primary">{t("nav.admin")}</Link>}
          </nav>
        </div>
      )}
    </header>
  );
};
