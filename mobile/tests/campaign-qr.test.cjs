const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/lib/campaign-qr.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleValue = { exports: {} };
new Function('exports', 'module', compiled)(moduleValue.exports, moduleValue);
const { campaignFromUrl } = moduleValue.exports;

test('campaign QR accepts only BiletFlow event links with a bounded campaign token', () => {
  assert.deepEqual(campaignFromUrl('https://api.biletflow.kz/events/jazz-night?c=student20', 'https://api.biletflow.kz'), {
    slug: 'jazz-night', token: 'student20',
  });
  assert.deepEqual(campaignFromUrl('http://localhost:8000/events/qa-event?c=qa', 'http://localhost:8000'), {
    slug: 'qa-event', token: 'qa',
  });
  assert.equal(campaignFromUrl('https://attacker.example/events/jazz-night?c=student20', 'https://api.biletflow.kz'), null);
  assert.equal(campaignFromUrl('http://api.biletflow.kz/events/jazz-night?c=student20', 'https://api.biletflow.kz'), null);
  assert.equal(campaignFromUrl('https://api.biletflow.kz/events/jazz-night', 'https://api.biletflow.kz'), null);
  assert.equal(campaignFromUrl(`https://api.biletflow.kz/events/jazz-night?c=${'x'.repeat(65)}`, 'https://api.biletflow.kz'), null);
  assert.equal(campaignFromUrl('BF1.adm.ticket.42.nonce.signature', 'https://api.biletflow.kz'), null);
});
