import type { InitOptions } from "i18next";

import en from "./locales/en.json";
import kk from "./locales/kk.json";
import ru from "./locales/ru.json";

export const supportedLocales = ["kk", "ru", "en"] as const;
export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "kk";
export const localeStorageKey = "biletflow.locale";
export const localeNames: Record<Locale, string> = {
  kk: "Қазақша",
  ru: "Русский",
  en: "English",
};
export const intlLocales: Record<Locale, string> = {
  kk: "kk-KZ",
  ru: "ru-KZ",
  en: "en-GB",
};

export const isLocale = (value: unknown): value is Locale =>
  supportedLocales.some((locale) => locale === value);

export const resolveLocale = (value?: string): Locale => {
  const language = value?.toLowerCase().split(/[-_]/)[0];
  return isLocale(language) ? language : defaultLocale;
};

export const detectLocale = (): Locale => {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    if (isLocale(saved)) return saved;
  } catch {
    // Browsers may disable storage; language selection still works in memory.
  }
  const languages = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  for (const language of languages) {
    if (!language) continue;
    const code = language.toLowerCase().split(/[-_]/)[0];
    if (isLocale(code)) return code;
  }
  return defaultLocale;
};

export const i18nOptions = {
  resources: { en: { translation: en }, kk: { translation: kk }, ru: { translation: ru } },
  supportedLngs: [...supportedLocales],
  fallbackLng: "en",
  load: "languageOnly",
  keySeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // React escapes rendered text.
  initAsync: false,
} satisfies InitOptions;
