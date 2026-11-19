import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Brand } from "../../../ui/Brand";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="mt-8 border-t border-line bg-white">
      <div className="site-container flex flex-wrap items-center justify-between gap-5 py-6">
        <Brand />
        <nav className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-muted">
          <Link to="/" className="hover:text-primary">{t("catalogue.title")}</Link>
          <Link to="/support" className="hover:text-primary">{t("common.help")}</Link>
        </nav>
      </div>
    </footer>
  );
};
