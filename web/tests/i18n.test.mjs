import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import ts from 'typescript';

const messages = Object.fromEntries(await Promise.all(['en', 'kk', 'ru'].map(async locale => [
  locale, JSON.parse(await readFile(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')),
])));

const sourceUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const jsonImports = Object.fromEntries(Object.entries(messages).map(([locale, dictionary]) => [
  `"./locales/${locale}.json"`, JSON.stringify(sourceUrl(`export default ${JSON.stringify(dictionary)}`)),
]));

async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  return sourceUrl(outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime'))));
}

const configUrl = await moduleUrl('../src/i18n/config.ts', jsonImports);
const { i18nOptions, detectLocale, localeStorageKey, resolveLocale, intlLocales } = await import(configUrl);
const validationUrl = await moduleUrl('../src/i18n/validation.ts', jsonImports);
const { validationMessage } = await import(validationUrl);
const priceUrl = await moduleUrl('../src/shared/lib/formatPrice.ts');
const { formatPrice } = await import(priceUrl);
const demoUrl = await moduleUrl('../src/features/Event/model/demoBooking.ts', {
  '"../../../shared/lib/formatPrice"': JSON.stringify(priceUrl),
});
const { getDemoBooking } = await import(demoUrl);

test('the app compiler accepts known translation keys and rejects unknown keys', () => {
  const configPath = fileURLToPath(new URL('../tsconfig.app.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL('../', import.meta.url)));
  assert.deepEqual(parsed.errors, []);
  const probePath = fileURLToPath(new URL('../src/i18n/translation-typecheck.ts', import.meta.url));
  const declarationsPath = fileURLToPath(new URL('../src/i18n/i18next.d.ts', import.meta.url));
  const probe = `
    import { useTranslation } from 'react-i18next';
    import type { TFunction } from 'i18next';
    export const useTypedTranslations = () => {
      const { t } = useTranslation();
      const home: string = t('common.home');
      const tickets: string = t('booking.continue', { count: 2 });
      // @ts-expect-error unknown translation keys must remain invalid
      t('missing.translation.key');
      return [home, tickets];
    };
    export const translateHome = (t: TFunction) => t('common.home');
  `;
  const options = { ...parsed.options, noEmit: true, tsBuildInfoFile: undefined, types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, ...args) => filename === probePath
    ? ts.createSourceFile(filename, probe, languageVersion, true)
    : getSourceFile(filename, languageVersion, ...args);
  const program = ts.createProgram([declarationsPath, probePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: filename => filename,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => '\n',
  }));
});

const instance = async locale => {
  const i18n = createInstance();
  await i18n.init({ ...i18nOptions, resources: structuredClone(i18nOptions.resources), lng: locale });
  return i18n;
};

test('uses a saved supported locale, then browser preferences, then Kazakh', () => {
  globalThis.localStorage = { getItem: () => 'ru' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de-DE', 'en-US'] } });
  assert.equal(detectLocale(), 'ru');
  localStorage.getItem = () => 'invalid';
  assert.equal(detectLocale(), 'en');
  localStorage.getItem = () => { throw new Error('Storage disabled'); };
  navigator.languages = ['de-DE', 'kk-KZ'];
  assert.equal(detectLocale(), 'kk');
  navigator.languages = ['de-DE'];
  assert.equal(detectLocale(), 'kk');
  assert.equal(resolveLocale('ru-KZ'), 'ru');
  assert.equal(resolveLocale('unsupported'), 'kk');
});

test('all locales translate the main interface and interpolate data as text', async () => {
  for (const [locale, expected] of [['kk', 'Кіру'], ['ru', 'Войти'], ['en', 'Sign in']]) {
    const i18n = await instance(locale);
    assert.equal(i18n.t('common.signIn'), expected);
    const email = '<user@example.com>';
    const rendered = renderToStaticMarkup(createElement('p', null, i18n.t('auth.registeredWith', { email })));
    assert.ok(rendered.includes('&lt;user@example.com&gt;'));
    assert.ok(!rendered.includes('<user@example.com>'));
  }
});

test('missing and empty translations fall back to English for progressive copy', async () => {
  const i18n = await instance('kk');
  i18n.addResourceBundle('kk', 'translation', { ...messages.kk, 'common.signIn': '' }, true, true);
  assert.equal(i18n.t('common.signIn'), messages.en['common.signIn']);
  const partial = createInstance();
  await partial.init({ ...i18nOptions, lng: 'ru', resources: { en: { translation: messages.en }, ru: { translation: {} } } });
  assert.equal(partial.t('auth.created'), messages.en['auth.created']);
});

test('Russian ticket counts use singular, few, and many forms', async () => {
  const i18n = await instance('ru');
  for (const [count, ending] of [[1, 'билет'], [2, 'билета'], [5, 'билетов'], [21, 'билет']]) {
    const result = i18n.t('booking.held', { count, time: '19:00' });
    assert.ok(result.startsWith(`${count} ${ending} `));
    assert.ok(result.endsWith('19:00'));
  }
});

test('client validation reacts to locale changes and service messages stay verbatim', async () => {
  const i18n = await instance('en');
  const error = { type: 'too_small', message: 'validation.passwordMin' };
  assert.equal(validationMessage(i18n.t, error), messages.en[error.message]);
  await i18n.changeLanguage('ru');
  assert.equal(validationMessage(i18n.t, error), messages.ru[error.message]);
  assert.equal(validationMessage(i18n.t, { type: 'server', message: 'validation.passwordMin' }), 'validation.passwordMin');
  assert.equal(validationMessage(i18n.t, { type: 'server', message: 'Email already registered' }), 'Email already registered');
});

test('localized booking labels preserve ticket identifiers, sessions, and prices', async () => {
  const i18n = await instance('en');
  const before = getDemoBooking(i18n.t, intlLocales.en);
  await i18n.changeLanguage('ru');
  const after = getDemoBooking(i18n.t, intlLocales.ru);
  assert.deepEqual(after.ticketTypes.map(({ id, price }) => ({ id, price })), before.ticketTypes.map(({ id, price }) => ({ id, price })));
  assert.notEqual(after.ticketTypes[1].name, before.ticketTypes[1].name);
  assert.deepEqual(after.halls.flatMap(hall => hall.sessions.map(({ id, time }) => ({ id, time }))), before.halls.flatMap(hall => hall.sessions.map(({ id, time }) => ({ id, time }))));
  assert.notEqual(after.halls[1].sessions[2].price, before.halls[1].sessions[2].price);
  assert.equal(formatPrice(8500, intlLocales.en), '8,500 ₸');
});

test('language controls expose the current selection and native language labels', async () => {
  const switcherUrl = await moduleUrl('../src/i18n/LanguageSwitcher.tsx', {
    '"react-i18next"': JSON.stringify(import.meta.resolve('react-i18next')),
    '"./config"': JSON.stringify(configUrl),
  });
  const { LanguageSwitcher } = await import(switcherUrl);
  const i18n = await instance('ru');
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(LanguageSwitcher)));
  assert.match(html, /aria-label="Язык интерфейса"/);
  assert.match(html, /lang="ru" aria-label="Русский" aria-pressed="true"/);
  assert.match(html, /Қазақша/);
  assert.match(html, /English/);
});

test('startup restores the preference, updates document language, and persists switches', async () => {
  const storage = new Map([[localeStorageKey, 'ru']]);
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.document = { documentElement: { lang: '' } };
  const entryUrl = await moduleUrl('../src/i18n/index.ts', {
    '"i18next"': JSON.stringify(import.meta.resolve('i18next')),
    '"react-i18next"': JSON.stringify(import.meta.resolve('react-i18next')),
    '"./config"': JSON.stringify(configUrl),
  });
  const { default: i18n } = await import(entryUrl);
  assert.equal(i18n.resolvedLanguage, 'ru');
  assert.equal(document.documentElement.lang, 'ru');
  await i18n.changeLanguage('kk');
  assert.equal(document.documentElement.lang, 'kk');
  assert.equal(storage.get(localeStorageKey), 'kk');
  localStorage.setItem = () => { throw new Error('Storage disabled'); };
  await assert.doesNotReject(i18n.changeLanguage('en'));
  assert.equal(document.documentElement.lang, 'en');
});

test('locale copy keeps interpolation parameters consistent with English', () => {
  const parameters = value => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
  for (const locale of ['kk', 'ru']) {
    for (const [key, value] of Object.entries(messages[locale])) {
      assert.ok(key in messages.en, `Unknown ${locale} translation: ${key}`);
      assert.deepEqual(parameters(value), parameters(messages.en[key]), `${locale}: ${key}`);
    }
  }
});
