import { dictionaries } from './messages';

export type Locale = 'en' | 'kk' | 'ru';
export type TranslationParams = Record<string, string | number>;
export const LOCALE_STORAGE_KEY = 'biletflow.locale.v1';

// API enum identifiers are UI labels in status badges; other unknown text stays intact.
const englishEnumLabels: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', expired: 'Expired', cancelled: 'Cancelled',
  refunded: 'Refunded', partially_refunded: 'Partially refunded', valid: 'Valid',
  checked_in: 'Checked in', published: 'Published', draft: 'Draft', suspended: 'Suspended',
  completed: 'Completed', event_admin: 'Event admin', organizer: 'Organizer',
};

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'kk' || value === 'ru';
}

export function translate(locale: Locale, source: string, params: TranslationParams = {}): string {
  const dictionary = locale === 'en' ? null : dictionaries[locale];
  const fallback = Object.prototype.hasOwnProperty.call(englishEnumLabels, source) ? englishEnumLabels[source] : source;
  const message = dictionary && Object.prototype.hasOwnProperty.call(dictionary, source) ? dictionary[source] : fallback;
  if (message === source && source.includes('\n')) {
    return source.split('\n').map((line) => translate(locale, line, params)).join('\n');
  }
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : placeholder);
}

export function formatLocalizedDate(locale: Locale, value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

export interface LocaleStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

/** Persists only the language code. Delayed startup reads never replace a user's choice. */
export function createLocalePreference(storage: LocaleStorage, onChange: (locale: Locale) => void) {
  let revision = 0;
  let writes: Promise<void> = Promise.resolve();
  return {
    async restore(shouldApply: () => boolean = () => true) {
      if (revision !== 0) return;
      const startedAt = revision;
      try {
        const stored = await storage.getItemAsync(LOCALE_STORAGE_KEY);
        if (revision === startedAt && shouldApply() && isLocale(stored)) onChange(stored);
      } catch {
        // Language selection still works when storage is unavailable.
      }
    },
    select(locale: Locale) {
      if (!isLocale(locale)) return;
      revision += 1;
      onChange(locale);
      // Serialize writes so a slower earlier selection cannot overwrite the latest one.
      writes = writes.then(() => storage.setItemAsync(LOCALE_STORAGE_KEY, locale)).catch(() => {});
    },
    whenIdle: () => writes,
  };
}
