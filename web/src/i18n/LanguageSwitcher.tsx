import { useTranslation } from "react-i18next";

import { localeNames, resolveLocale, supportedLocales } from "./config";

export const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();
  const currentLocale = resolveLocale(i18n.language);

  return (
    <div role="group" aria-label={t("locale.label")} className="flex items-center gap-3">
      {supportedLocales.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-label={localeNames[locale]}
          aria-pressed={currentLocale === locale}
          onClick={() => void i18n.changeLanguage(locale)}
          className={`rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 ${currentLocale === locale ? "font-bold underline underline-offset-4" : "opacity-75 hover:opacity-100"}`}
        >
          {localeNames[locale]}
        </button>
      ))}
    </div>
  );
};
