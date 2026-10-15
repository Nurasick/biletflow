import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../../../i18n/LanguageSwitcher";
export const UtilityBar = () => {
  const { t } = useTranslation();
  return (
    <div className="bg-[#101828] px-7 py-2.5 text-xs text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-5">
          <span className="font-semibold">{t("nav.city")} ▾</span>
          <span className="text-[#98A2B3]">{t("common.help")}</span>
          <span className="text-[#98A2B3]">{t("nav.forOrganizers")}</span>
        </div>
        <div className="flex items-center gap-5 text-[#98A2B3]">
          <LanguageSwitcher />
          <span>+7 727 000 00 00</span>
        </div>
      </div>
    </div>
  );
};
