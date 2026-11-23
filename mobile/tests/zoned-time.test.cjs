const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/lib/zoned-time.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', compiled)(mod.exports, mod);
const { wallClockToIso, isoToWallClock, wallClockValue, optionalIso, requiredIso, INVALID_DATE_TIME } = mod.exports;

test('Almaty wall-clock time becomes the matching UTC instant (UTC+5, no DST)', () => {
  assert.equal(wallClockToIso('2026-12-01', '19:00', 'Asia/Almaty'), '2026-12-01T14:00:00.000Z');
  assert.equal(wallClockToIso('2026-12-01', '', 'Asia/Almaty'), '2026-11-30T19:00:00.000Z', 'empty time means midnight');
  assert.equal(wallClockToIso('2026-12-01', '3:05', 'Asia/Almaty'), '2026-11-30T22:05:00.000Z', 'single-digit hour accepted');
});

test('zones with daylight saving resolve on both sides of the change', () => {
  assert.equal(wallClockToIso('2026-01-15', '12:00', 'Europe/Berlin'), '2026-01-15T11:00:00.000Z');
  assert.equal(wallClockToIso('2026-07-15', '12:00', 'Europe/Berlin'), '2026-07-15T10:00:00.000Z');
});

test('impossible or malformed input is rejected instead of rolled over', () => {
  for (const [date, time] of [['2026-02-30', '10:00'], ['2026-13-01', '10:00'], ['01.12.2026', '10:00'], ['2026-12-01', '24:00'], ['2026-12-01', '19:60'], ['2026-12-01', '7pm']]) {
    assert.equal(wallClockToIso(date, time, 'Asia/Almaty'), null, `${date} ${time}`);
  }
  assert.equal(wallClockToIso('2026-12-01', '10:00', 'Not/AZone'), null, 'unknown zone');
});

test('stored instants are shown back in the event zone and round-trip unchanged', () => {
  assert.deepEqual(isoToWallClock('2026-12-01T14:00:00Z', 'Asia/Almaty'), { date: '2026-12-01', time: '19:00' });
  assert.deepEqual(isoToWallClock('2026-11-30T20:30:00Z', 'Asia/Almaty'), { date: '2026-12-01', time: '01:30' }, 'crosses midnight');
  assert.deepEqual(isoToWallClock('', 'Asia/Almaty'), { date: '', time: '' });
  assert.deepEqual(isoToWallClock(INVALID_DATE_TIME, 'Asia/Almaty'), { date: '', time: '' });
  const shown = isoToWallClock('2026-07-15T10:00:00Z', 'Europe/Berlin');
  assert.equal(wallClockToIso(shown.date, shown.time, 'Europe/Berlin'), '2026-07-15T10:00:00.000Z');
});

test('field values distinguish empty, valid and partially typed input', () => {
  assert.equal(wallClockValue({ date: '', time: '' }, 'Asia/Almaty'), '');
  assert.equal(wallClockValue({ date: '2026-12-01', time: '19:00' }, 'Asia/Almaty'), '2026-12-01T14:00:00.000Z');
  assert.equal(wallClockValue({ date: '2026-12', time: '' }, 'Asia/Almaty'), INVALID_DATE_TIME);
  assert.equal(wallClockValue({ date: '', time: '19:00' }, 'Asia/Almaty'), INVALID_DATE_TIME);
});

test('API helpers send null for empty optional fields and refuse invalid ones with a readable message', () => {
  assert.equal(optionalIso(''), null);
  assert.equal(optionalIso(null), null);
  assert.equal(optionalIso('2026-12-01T14:00:00.000Z'), '2026-12-01T14:00:00.000Z');
  assert.throws(() => optionalIso(INVALID_DATE_TIME), /Check the date and time fields/);
  assert.throws(() => requiredIso(''), /Check the date and time fields/);
});
