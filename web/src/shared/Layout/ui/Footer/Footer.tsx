import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="mt-10 border-t border-[#D0D5DD] bg-[#F5F5F0]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-7 py-5 text-sm">
        <Link to="/" aria-label={t("common.home")} className="font-semibold hover:text-[#D9431F]">BiletFlow</Link>
        <Link to="/support" className="text-[#667085] hover:text-[#101828]">{t("common.help")}</Link>
      </div>
    </footer>
  );
};
