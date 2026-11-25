const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file) {
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const value = { exports: {} };
  new Function('exports', 'module', js)(value.exports, value);
  return value.exports;
}

const {
  normalizePayoutProvider,
  mergeHistoryActions,
  cycleHistoryAction,
} = load('../src/lib/organizer-filters.ts');

test('normalizePayoutProvider accepts only supported sandbox providers and falls back to sandbox_bank', () => {
  assert.equal(normalizePayoutProvider('sandbox_bank'), 'sandbox_bank');
  assert.equal(normalizePayoutProvider('sandbox_wallet'), 'sandbox_wallet');
  assert.equal(normalizePayoutProvider('Demo Bank'), 'sandbox_bank');
  assert.equal(normalizePayoutProvider(''), 'sandbox_bank');
  assert.equal(normalizePayoutProvider(null), 'sandbox_bank');
  assert.equal(normalizePayoutProvider(undefined), 'sandbox_bank');
});

test('mergeHistoryActions unions unique actions so filtering never loses options', () => {
  const initial = mergeHistoryActions([], [
    { action: 'event.created' },
    { action: 'event.published' },
    { action: 'event.created' },
  ]);
  assert.deepEqual(initial, ['event.created', 'event.published']);

  const afterFiltered = mergeHistoryActions(initial, [{ action: 'event.published' }]);
  assert.deepEqual(afterFiltered, ['event.created', 'event.published']);

  const withNew = mergeHistoryActions(afterFiltered, [{ action: 'campaign.created' }]);
  assert.deepEqual(withNew, ['event.created', 'event.published', 'campaign.created']);
});

test('cycleHistoryAction leaves All on first tap and wraps cleanly back to All', () => {
  const actions = ['event.created', 'event.published'];
  assert.equal(cycleHistoryAction('', actions), 'event.created');
  assert.equal(cycleHistoryAction('event.created', actions), 'event.published');
  assert.equal(cycleHistoryAction('event.published', actions), '');
  assert.equal(cycleHistoryAction('', []), '');
  assert.equal(cycleHistoryAction('stale.action', actions), '');
});
