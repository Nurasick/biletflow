import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "../../../../i18n/LanguageSwitcher";
export const UtilityBar = () => {
  const { t } = useTranslation();
  return (
    <div className="bg-[#101828] px-7 py-2.5 text-xs text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link to="/support" className="text-[#D0D5DD] hover:text-white">{t("common.help")}</Link>
        <LanguageSwitcher />
      </div>
    </div>
  );
};
