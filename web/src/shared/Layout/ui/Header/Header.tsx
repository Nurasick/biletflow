import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { NotificationLink } from "../../../../features/Notifications/ui/NotificationLink";
import { useAuth } from "../../../../hooks/useAuth";

export const Header = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const navigate = useNavigate();
  const user = me.data;
  return (
    <header className="border-b border-[#D0D5DD]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 sm:px-7">
        <Link
          to="/"
          aria-label={t("common.home")}
          className="shrink-0 text-2xl font-bold tracking-tight"
        >
          Bilet<span className="text-[#FF5C35]">Flow</span>
        </Link>

        <form role="search" className="order-last flex h-12 w-full min-w-0 overflow-hidden rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] md:order-none md:w-auto md:flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const q = new FormData(event.currentTarget).get("q")?.toString().trim() ?? "";
            navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
          }}>
          <input
            type="search"
            name="q"
            aria-label={t("nav.searchPlaceholder")}
            placeholder={t("nav.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent px-4 text-sm outline-none placeholder:text-[#667085]"
          />
          <button type="submit" className="bg-[#FF5C35] px-6 text-sm font-semibold text-[#101828]">
            {t("nav.search")}
          </button>
        </form>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {user && <NotificationLink userId={user.id} />}

          {me.isPending ? (
            <span className="text-xs text-[#667085]">{t("nav.checkingSession")}</span>
          ) : me.isError ? (
            <button onClick={() => void me.refetch()} className="text-sm">{t("nav.retrySession")}</button>
          ) : user ? (
            <Link to="/account" className="flex items-center gap-3 rounded-full border border-[#D0D5DD] py-1.5 pl-1.5 pr-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-orange-50 text-xs font-semibold text-[#FF5C35]">
                {user.first_name.slice(0, 1)}{user.last_name.slice(0, 1)}
              </span>
              <span className="max-w-36 truncate text-xs font-semibold">{user.first_name} {user.last_name}</span>
            </Link>
          ) : (
            <Link to="/login" className="rounded-xl border border-[#D0D5DD] px-5 py-3 text-sm font-semibold">{t("common.signIn")}</Link>
          )}

          <Link to="/organizer/events/new" className="rounded-xl bg-[#FF5C35] px-5 py-3 text-sm font-semibold text-[#101828]">
            {t("nav.createEvent")}
          </Link>
        </div>
      </div>

      {user && (
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-7 py-3 text-sm">
          <Link to="/staff/events" className="font-semibold text-[#A93216]">{t("nav.checkIn")}</Link>
          {(user.is_organizer || user.is_platform_admin) && <Link to="/staff/support" className="font-semibold text-[#A93216]">{t("support.queue")}</Link>}
          {user.is_platform_admin && <Link to="/admin" className="font-semibold text-[#A93216]">{t("nav.admin")}</Link>}
        </nav>
      )}
    </header>
  );
};
