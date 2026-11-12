const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('exports', 'module', result.outputText)(module.exports, module);
  return module.exports;
}
const { staffApi, StaffApiError } = load('../src/shared/api/staff.ts');
const { createScanSession } = load('../src/lib/scan-session.ts');
const checkedInTicket = { public_code: 'TEST-TICKET', status: 'checked_in', attendee_name: 'Test attendee', ticket_type_name: 'Admission' };

test('staff requests only the server-assigned event list and forwards cancellation', async () => {
  const controller = new AbortController();
  const calls = [];
  const fetcher = async (path, init) => { calls.push({ path, init }); return Response.json([{ id: 3, title: 'Assigned event' }]); };
  const events = await staffApi.events(fetcher, controller.signal);
  assert.equal(events[0].id, 3);
  assert.equal(calls[0].path, '/staff/events');
  assert.equal(calls[0].init.signal, controller.signal);
});

test('all six admission outcomes remain distinct, including campaign rejection', async () => {
  for (const outcome of ['valid', 'invalid', 'wrong_event', 'cancelled', 'refunded', 'already_used']) {
    const calls = [];
    const result = await staffApi.scan(async (path, init) => {
      calls.push({ path, body: JSON.parse(init.body) });
      return Response.json({ outcome, ticket: outcome === 'invalid' ? null : checkedInTicket });
    }, 7, outcome === 'invalid' ? 'https://example.test/events/show?campaign=sample' : 'sample-admission-payload', 'Test device');
    assert.equal(result.outcome, outcome);
    assert.equal(calls[0].path, '/staff/events/7/scan');
    assert.equal(calls[0].body.device_info, 'Test device');
    if (outcome === 'invalid') assert.equal(result.ticket, null);
  }
});

test('empty and oversized QR data never reach admission endpoint', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ outcome: 'valid', ticket: checkedInTicket }); };
  await assert.rejects(staffApi.scan(fetcher, 7, '   ', 'test'), /Invalid ticket/);
  await assert.rejects(staffApi.scan(fetcher, 7, 'x'.repeat(513), 'test'), /Invalid ticket/);
  assert.equal(calls, 0);
});

test('malformed success responses cannot approve admission', async () => {
  for (const body of [{ outcome: 'approved', ticket: checkedInTicket }, { outcome: 'valid', ticket: null }, { outcome: 'valid', ticket: { ...checkedInTicket, status: 'valid' } }]) {
    await assert.rejects(staffApi.scan(async () => Response.json(body), 7, 'sample-payload', 'test'), /Result unknown/);
  }
});

test('server authorization failures remain failures and carry their status', async () => {
  await assert.rejects(staffApi.attendance(async () => Response.json({ detail: 'Not assigned' }, { status: 403 }), 7), error => error instanceof StaffApiError && error.status === 403);
  await assert.rejects(staffApi.scan(async () => Response.json({ detail: 'Not assigned' }, { status: 403 }), 7, 'sample-payload', 'test'), error => error.status === 403);
});

test('network failures after a mutation require reconciliation and are never retried', async () => {
  let calls = 0;
  await assert.rejects(staffApi.checkIn(async () => { calls++; throw new TypeError('Offline'); }, 7, 'TEST-TICKET', 'test'), /Result unknown/);
  assert.equal(calls, 1);
});

test('manual search and reversal use event-scoped encoded identifiers', async () => {
  const calls = [];
  const fetcher = async (path, init) => { calls.push({ path, init }); return Response.json(path.endsWith('/reverse') ? { ...checkedInTicket, status: 'valid' } : []); };
  await staffApi.search(fetcher, 9, '  Name & code  ');
  await staffApi.reverse(fetcher, 9, 'CODE/123', 'test');
  assert.equal(calls[0].path, '/staff/events/9/search?q=Name%20%26%20code');
  assert.equal(calls[1].path, '/staff/events/9/tickets/CODE%2F123/reverse');
  assert.equal(calls[1].init.method, 'POST');
  assert.throws(() => staffApi.search(fetcher, 9, 'x'), /between 2 and 100/);
});

test('scan session admits only one in-flight operation and requires explicit acknowledgement', async () => {
  const session = createScanSession();
  let complete;
  let calls = 0;
  const first = session.submit(async () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const second = await session.submit(async () => { calls++; });
  assert.deepEqual(second, { accepted: false });
  assert.equal(session.reset(), false);
  complete('confirmed');
  assert.deepEqual(await first, { accepted: true, result: 'confirmed' });
  assert.deepEqual(await session.submit(async () => { calls++; }), { accepted: false });
  assert.equal(calls, 1);
  assert.equal(session.reset(), true);
  assert.equal((await session.submit(async () => 'next')).accepted, true);
});

test('failed admission stays locked until acknowledged and cannot silently retry', async () => {
  const session = createScanSession();
  await assert.rejects(session.submit(async () => { throw new Error('uncertain'); }), /uncertain/);
  assert.deepEqual(await session.submit(async () => 'retry'), { accepted: false });
  assert.equal(session.getState(), 'finished');
  assert.equal(session.reset(), true);
});


test('server faults and malformed reversal replies never report successful entry changes', async () => {
  await assert.rejects(staffApi.scan(async () => Response.json({ detail: 'Internal error' }, { status: 500 }), 7, 'sample-payload', 'test'), /Result unknown/);
  await assert.rejects(staffApi.reverse(async () => Response.json({ status: 'checked_in' }), 7, 'TEST-TICKET', 'test'), /Result unknown/);
});
