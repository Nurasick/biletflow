import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as SessionStorage from '@/lib/session-storage';
import { createLocalePreference, formatLocalizedDate, translate, type Locale, type TranslationParams } from './core';

export type { Locale } from './core';
export const LANGUAGES = [
  { locale: 'en', label: 'English' },
  { locale: 'kk', label: 'Қазақша' },
  { locale: 'ru', label: 'Русский' },
] as const;

type I18nValue = {
  t: (sourceEnglish: string, params?: TranslationParams) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  formatDate: (value: string, timeZone?: string) => string;
  formatNumber: (value: number) => string;
};
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const preference = useMemo(() => createLocalePreference(SessionStorage, setLocaleState), []);

  useEffect(() => {
    let active = true;
    void preference.restore(() => active);
    return () => { active = false; };
  }, [preference]);

  const setLocale = useCallback((next: Locale) => preference.select(next), [preference]);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (source, params) => translate(locale, source, params),
    formatDate: (date, timeZone) => formatLocalizedDate(locale, date, timeZone),
    formatNumber: (number) => new Intl.NumberFormat(locale).format(number),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}

export function LanguageSelector({ disabled = false }: { disabled?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <View accessibilityLabel={t('Language')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 14 }}>
      {LANGUAGES.map((language) => (
        <Pressable key={language.locale} accessibilityRole="button" accessibilityState={{ selected: locale === language.locale, disabled }} disabled={disabled} onPress={() => setLocale(language.locale)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: locale === language.locale ? '#FF5C35' : '#667085', backgroundColor: locale === language.locale ? '#FF5C35' : '#182230', opacity: disabled ? 0.6 : 1 }}>
          <Text style={{ color: '#FFFFFF', fontWeight: locale === language.locale ? '700' : '400', fontSize: 13 }}>{language.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
