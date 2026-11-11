import { useTranslation } from "react-i18next";
import { ConfigProvider } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "../../../i18n/LanguageSwitcher";

type AuthShellProps = {
  children: ReactNode;
  top?: ReactNode;
};

export const AuthShell = ({ children, top }: AuthShellProps) => {
  const { t } = useTranslation();
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#FF5C35",
          colorText: "#101828",
          colorBgContainer: "#F5F5F0",
          colorBorder: "#D0D5DD",
          borderRadius: 9,
          controlHeight: 46,
          fontSize: 13,
        },
      }}
    >
      <div className="flex min-h-screen flex-col bg-[#F5F5F0] text-[#101828]">
        <header className="bg-[#101828] text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-7 py-4">
            <Link to="/" aria-label={t("common.home")} className="text-2xl font-bold tracking-tight">
              Bilet<span className="text-[#FF5C35]">Flow</span>
            </Link>
            <div className="text-xs"><LanguageSwitcher /></div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[438px] flex-1 flex-col justify-center px-6 py-10">
          {top && <div className="mb-5 flex justify-end text-xs text-[#667085]">{top}</div>}
          {children}
        </main>

        <footer className="px-6 pb-7 text-center text-xs text-[#667085]">
          <Link to="/support" className="hover:underline">{t("common.help")}</Link>
        </footer>
      </div>
    </ConfigProvider>
  );
};
