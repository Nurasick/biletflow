import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { detectLocale, i18nOptions, localeStorageKey, resolveLocale } from "./config";

const synchronizeLocale = (language: string) => {
  const locale = resolveLocale(language);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Persisting a preference is optional when browser storage is unavailable.
  }
};

i18n.on("languageChanged", synchronizeLocale);
void i18n.use(initReactI18next).init({ ...i18nOptions, lng: detectLocale() });

export default i18n;
