import { useTranslation } from "react-i18next";

import { localeNames, resolveLocale, supportedLocales } from "./config";

export const LanguageSwitcher = ({ compact = false }: { compact?: boolean }) => {
  const { t, i18n } = useTranslation();
  const currentLocale = resolveLocale(i18n.language);

  if (compact) {
    return (
      <label className="relative flex min-h-10 items-center gap-2 rounded-xl border border-line bg-white px-2.5 text-sm font-semibold text-muted-strong focus-within:outline-2 focus-within:outline-primary">
        <span aria-hidden="true">{currentLocale.toUpperCase()}</span>
        <span aria-hidden="true" className="mb-1 size-1.5 rotate-45 border-r border-b" />
        <select
          value={currentLocale}
          aria-label={t("locale.label")}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        >
          {supportedLocales.map((locale) => <option key={locale} value={locale} lang={locale}>{localeNames[locale]}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div role="group" aria-label={t("locale.label")} className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-soft p-1 text-sm">
      {supportedLocales.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-label={localeNames[locale]}
          aria-pressed={currentLocale === locale}
          onClick={() => void i18n.changeLanguage(locale)}
          className={`min-h-9 rounded-lg px-2.5 font-semibold ${currentLocale === locale ? "bg-white text-primary shadow-xs" : "text-muted hover:text-ink"}`}
        >
          {localeNames[locale]}
        </button>
      ))}
    </div>
  );
};
