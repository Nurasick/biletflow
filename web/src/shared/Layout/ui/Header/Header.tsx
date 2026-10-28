import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../hooks/useAuth";

export const Header = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const navigate = useNavigate();
  const user = me.data;
  return (
    <header className="border-b border-[#D0D5DD]">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-7 py-4">
        <Link
          to="/"
          aria-label={t("common.home")}
          className="shrink-0 text-2xl font-bold tracking-tight"
        >
          Bilet<span className="text-[#FF5C35]">Flow</span>
        </Link>

        <form role="search" className="flex h-12 flex-1 overflow-hidden rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]"
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
          <button type="button" className="border-l border-[#D0D5DD] px-4 text-sm text-[#667085]">
            {t("nav.anyDate")} ▾
          </button>
          <button type="submit" className="bg-[#FF5C35] px-6 text-sm font-semibold text-[#101828]">
            {t("nav.search")}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <button aria-label={t("nav.menu")} className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#D0D5DD] text-[#667085]">
            ☰
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#FF5C35] px-1 text-[10px] font-semibold text-[#101828]">
              2
            </span>
          </button>

          {me.isPending ? (
            <span className="text-xs text-[#667085]">{t("nav.checkingSession")}</span>
          ) : me.isError ? (
            <button onClick={() => void me.refetch()} className="text-sm">{t("nav.retrySession")}</button>
          ) : user ? (
            <Link to="/account" className="flex items-center gap-3 rounded-full border border-[#D0D5DD] py-1.5 pl-1.5 pr-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-orange-50 text-xs font-semibold text-[#FF5C35]">
                {user.first_name.slice(0, 1)}{user.last_name.slice(0, 1)}
              </span>
              <span className="text-xs font-semibold">{user.first_name} {user.last_name}</span>
            </Link>
          ) : (
            <Link to="/login" className="rounded-xl border border-[#D0D5DD] px-5 py-3 text-sm font-semibold">{t("common.signIn")}</Link>
          )}

          <Link to="/organizer/events/new" className="rounded-xl bg-[#FF5C35] px-5 py-3 text-sm font-semibold text-[#101828]">
            {t("nav.createEvent")}
          </Link>
        </div>
      </div>

      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-7 py-3 text-sm">
        <a className="font-semibold" href="#">
          {t("nav.afisha")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.concerts")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.theatre")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.cinema")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.sport")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.student")}
        </a>
        <a className="text-[#667085]" href="#">
          {t("nav.freeEvents")}
        </a>
        <a className="ml-auto font-semibold text-[#FF5C35]" href="#">
          {t("nav.myTickets")}
        </a>
      </nav>
    </header>
  );
};
