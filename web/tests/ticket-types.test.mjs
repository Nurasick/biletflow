import assert from 'node:assert/strict';
import test from 'node:test';

import { moduleUrl } from './harness.mjs';

const apiTimeUrl = await moduleUrl('../src/shared/lib/parseApiInstant.ts');
const apiTimeImport = { '"../../../shared/lib/parseApiInstant"': JSON.stringify(apiTimeUrl) };
const timeUrl = await moduleUrl('../src/features/Organizer/model/eventDateTime.ts', apiTimeImport);
const hundredthsUrl = await moduleUrl('../src/shared/lib/parseHundredths.ts');
const { ticketTypeDraft, ticketTypeInput, ticketTypeChanges } = await import(await moduleUrl(
  '../src/features/Organizer/model/ticketTypeForm.ts', {
    ...apiTimeImport,
    '"./eventDateTime"': JSON.stringify(timeUrl),
    '"../../../shared/lib/parseHundredths"': JSON.stringify(hundredthsUrl),
  },
));
const { ticketSaleWindow, ticketSaleStatus } = await import(await moduleUrl('../src/features/Event/model/ticketSales.ts', apiTimeImport));
const zone = 'Asia/Almaty';
const ticket = {
  name: 'Early Bird', description: 'First row', price_minor: 184900, quantity_total: 20,
  quantity_sold: 5, quantity_reserved: 3, sales_start_at: '2026-11-11T04:15:32.400Z',
  sales_end_at: '2026-11-12T04:15:00Z', max_per_order: 3, position: 1, is_hidden: false,
};

test('editing only sends changed fields, preserves timestamp seconds, and clears nullable values', () => {
  const draft = ticketTypeDraft(zone, ticket);
  assert.equal(draft.starts, '2026-11-11T09:15');
  const result = ticketTypeInput({ ...draft, price: '1750,05', ends: '', maxPerOrder: '', description: '' }, zone, 8, ticket);
  assert.equal(result.input.sales_start_at, ticket.sales_start_at);
  assert.deepEqual(ticketTypeChanges(result.input, ticket), {
    price_minor: 175005, sales_end_at: null, max_per_order: null, description: null,
  });
});

test('ticket editing preserves the existing commitments and rejects reversed sales windows', () => {
  const draft = ticketTypeDraft(zone, ticket);
  assert.deepEqual(ticketTypeInput({ ...draft, quantity: '7' }, zone, 8, ticket), {
    field: 'quantity', error: 'ticketTypes.quantityCommitted',
  });
  assert.equal(ticketTypeInput({ ...draft, quantity: '8' }, zone, 8, ticket).input.quantity_total, 8);
  assert.equal(ticketTypeInput({ ...draft, price: '19.999' }, zone, 8, ticket).error, 'ticketTypes.invalidPrice');
  assert.equal(ticketTypeInput({ ...draft, ends: '2026-11-11T09:15' }, zone, 8, ticket).error, 'ticketTypes.invalidWindow');
});

test('an API timestamp without an offset is read as UTC and stays unchanged on unrelated edits', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const stored = { ...ticket, sales_start_at: '2026-11-11T04:15:32.400' };
    const draft = ticketTypeDraft(zone, stored);
    assert.equal(draft.starts, '2026-11-11T09:15');
    const result = ticketTypeInput({ ...draft, name: 'Renamed' }, zone, 8, stored);
    assert.deepEqual(ticketTypeChanges(result.input, stored), { name: 'Renamed' });
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('public checkout opens and closes at the intersection of the event and ticket windows', () => {
  const event = {
    registration_opens_at: '2026-11-11T04:30:00Z',
    registration_closes_at: '2026-11-12T04:00:00Z',
    ends_at: '2026-11-13T00:00:00Z',
  };
  const window = ticketSaleWindow(event, ticket);
  assert.equal(ticketSaleStatus(window, Date.parse(event.registration_opens_at) - 1), 'upcoming');
  assert.equal(ticketSaleStatus(window, Date.parse(event.registration_opens_at)), 'open');
  assert.equal(ticketSaleStatus(window, Date.parse(event.registration_closes_at)), 'closed');
  assert.equal(ticketSaleStatus(ticketSaleWindow(event, { ...ticket, sales_end_at: '2026-11-11T04:20:00Z' }),
    Date.parse(event.registration_opens_at)), 'unavailable');
});
