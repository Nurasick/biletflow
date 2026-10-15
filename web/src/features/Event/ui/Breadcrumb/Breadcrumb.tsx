import { useTranslation } from "react-i18next";

export const Breadcrumb = () => {
  const { t } = useTranslation();
  return (
    <div className="border-b border-[#D0D5DD] px-7 py-3.5 text-xs text-[#667085]">
      {t("nav.afisha")} · {t("nav.concerts")} ·{" "}
      <span className="text-[#101828]">{t("demo.eventName")}</span>
    </div>
  );
};
