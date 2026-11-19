import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { LanguageSwitcher } from "../../../i18n/LanguageSwitcher";
import { Brand, BrandTicket } from "../../../shared/ui/Brand";

type AuthShellProps = {
  children: ReactNode;
  top?: ReactNode;
};

export const AuthShell = ({ children, top }: AuthShellProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-white">
        <div className="site-container flex min-h-[72px] flex-wrap items-center justify-between gap-3 py-3">
          <Brand />
          <div className="flex items-center gap-4">
            <Link to="/support" className="hidden text-sm font-semibold text-muted hover:text-primary sm:inline">{t("common.help")}</Link>
            <LanguageSwitcher compact />
          </div>
        </div>
      </header>

      <div className="site-container grid flex-1 gap-8 py-6 sm:py-10 lg:grid-cols-[0.95fr_1fr] lg:gap-12">
        <aside className="brand-art relative isolate hidden min-h-[35rem] flex-col justify-between overflow-hidden rounded-[1.75rem] p-10 text-white lg:flex">
          <div className="mx-auto flex w-full flex-1 items-center justify-center px-8 py-10"><BrandTicket /></div>
          <div className="relative rounded-xl bg-stage/85 px-4 py-3">
            <p className="max-w-md text-4xl leading-[1.02] font-extrabold tracking-[-0.06em]">{t("auth.ticketTitle")}</p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#e1d9f9]">{t("auth.ticketDescription")}</p>
          </div>
        </aside>

        <main className="mx-auto flex w-full max-w-lg flex-col justify-center">
          <div className="panel px-5 py-7 sm:px-9 sm:py-10">
            {children}
            {top && <div className="mt-7 border-t border-line-soft pt-5 text-sm text-muted">{top}</div>}
          </div>
          <Link to="/support" className="mx-auto mt-5 text-sm font-semibold text-muted hover:text-primary sm:hidden">{t("common.help")}</Link>
        </main>
      </div>
    </div>
  );
};
