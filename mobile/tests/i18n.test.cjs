const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScript(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', compiled)(module.exports, module, (specifier) =>
    specifier.startsWith('.') ? loadTypeScript(path.resolve(path.dirname(filename), specifier + '.ts')) : require(specifier));
  return module.exports;
}
const core = loadTypeScript(path.resolve(__dirname, '../src/i18n/core.ts'));
const { dictionaries } = loadTypeScript(path.resolve(__dirname, '../src/i18n/messages.ts'));

test('Kazakh and Russian translate placeholders while unknown source text stays readable', () => {
  assert.equal(core.translate('ru', 'Unread: {count}', { count: 12 }), 'Непрочитанных: 12');
  assert.equal(core.translate('kk', 'Unread: {count}', { count: 3 }), 'Оқылмаған: 3');
  assert.equal(core.translate('kk', 'Unknown server detail: {code}', { code: 409 }), 'Unknown server detail: 409');
  assert.equal(core.translate('en', 'Unread: {count}'), 'Unread: {count}');
  assert.equal(core.translate('ru', 'constructor'), 'constructor');
  assert.equal(core.translate('ru', 'Invalid email\nPassword too short'), 'Неверная почта\nСлишком короткий пароль');
  assert.equal(core.translate('en', 'checked_in'), 'Checked in');
  assert.equal(core.translate('en', 'partially_refunded'), 'Partially refunded');
  assert.equal(core.translate('en', 'unknown_server_value'), 'unknown_server_value');
});

test('both dictionaries retain every interpolation token', () => {
  const tokens = (text) => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
  assert.deepEqual(Object.keys(dictionaries.ru).sort(), Object.keys(dictionaries.kk).sort());
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const [source, translated] of Object.entries(dictionary)) {
      assert.ok(translated.trim(), `${locale}: ${source}`);
      assert.deepEqual(tokens(translated), tokens(source), `${locale}: ${source}`);
    }
  }
});

test('every explicit translation in mobile screens is available in both dictionaries', () => {
  const keys = new Set();
  function collect(argument) {
    if (!argument) return;
    if (ts.isStringLiteral(argument) && argument.text) keys.add(argument.text);
    if (ts.isConditionalExpression(argument)) {
      collect(argument.whenTrue);
      collect(argument.whenFalse);
    }
  }
  function readDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { readDirectory(filename); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't') collect(node.arguments[0]);
        node.forEachChild(visit);
      }
      visit(source);
    }
  }
  readDirectory(path.resolve(__dirname, '../src'));
  for (const locale of ['ru', 'kk']) {
    for (const key of keys) assert.ok(Object.hasOwn(dictionaries[locale], key), `${locale} is missing: ${key}`);
  }
});

test('restored locale only accepts a supported code, and persistence contains only the chosen code', async () => {
  let selected = 'en';
  const writes = [];
  const preference = core.createLocalePreference({ getItemAsync: async () => 'kk', setItemAsync: async (...entry) => writes.push(entry) }, (next) => { selected = next; });
  await preference.restore();
  assert.equal(selected, 'kk');
  preference.select('ru');
  await preference.whenIdle();
  assert.deepEqual(writes, [[core.LOCALE_STORAGE_KEY, 'ru']]);
  const invalid = core.createLocalePreference({ getItemAsync: async () => '{"locale":"ru","extra":"data"}', setItemAsync: async () => {} }, () => assert.fail('Malformed preference must be ignored'));
  await invalid.restore();
});

test('a delayed preference read cannot overwrite a choice made during startup', async () => {
  let resolveRead;
  let selected = 'en';
  const preference = core.createLocalePreference({ getItemAsync: () => new Promise((resolve) => { resolveRead = resolve; }), setItemAsync: async () => {} }, (next) => { selected = next; });
  const restore = preference.restore();
  preference.select('kk');
  resolveRead('ru');
  await restore;
  assert.equal(selected, 'kk');
  await preference.restore();
  assert.equal(selected, 'kk');
});

test('storage failures do not prevent language selection, and rapid choices write in order', async () => {
  let selected = 'en';
  const blocked = core.createLocalePreference({ getItemAsync: async () => { throw new Error('blocked'); }, setItemAsync: async () => { throw new Error('blocked'); } }, (next) => { selected = next; });
  await blocked.restore();
  blocked.select('ru');
  await blocked.whenIdle();
  assert.equal(selected, 'ru');
  const writes = [];
  let stored;
  let finishSlowWrite;
  const preference = core.createLocalePreference({ getItemAsync: async () => null, setItemAsync: async (_, locale) => {
    if (locale === 'ru') await new Promise((resolve) => { finishSlowWrite = resolve; });
    stored = locale;
    writes.push(locale);
  } }, () => {});
  preference.select('ru');
  preference.select('kk');
  await Promise.resolve();
  finishSlowWrite();
  await preference.whenIdle();
  assert.deepEqual(writes, ['ru', 'kk']);
  assert.equal(stored, 'kk');
});

test('localized date formatting honors the event timezone and handles invalid inputs', () => {
  const value = '2026-10-28T20:00:00Z';
  assert.equal(core.formatLocalizedDate('ru', value, 'Asia/Almaty'), new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(value)));
  assert.equal(core.formatLocalizedDate('kk', 'not-a-date'), 'not-a-date');
  assert.doesNotThrow(() => core.formatLocalizedDate('kk', value, 'invalid-timezone'));
});
