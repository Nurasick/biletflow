import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

// The lifecycle rules themselves live on the server now and are tested there
// (backend/tests/test_event_lifecycle.py). These tests pin the adapter: which
// requests it makes and how it shapes the answers for the workflow UI.
const lifecycleUrl = await moduleUrl('../src/shared/api/eventLifecycle.ts', {
  '"./auth"': JSON.stringify(fakeAuthUrl),
});
const { eventLifecycleApi, EventWorkflowError } = await import(lifecycleUrl);

const event = { id: 7, title: 'Indie Night', status: 'draft', timezone: 'Asia/Almaty', updated_at: '2030-01-01T00:00:00Z' };
const preview = {
  event,
  images: [{ id: 1, url: 'http://x/cover.png', position: 0 }, { id: 2, url: 'http://x/g.png', position: 1 }],
  publish_requirements: [{ code: 'title', met: true }, { code: 'visible_ticket_type', met: true }],
  allowed_actions: ['publish', 'cancel'],
};
const types = [
  { id: 1, name: 'General', description: null, price_minor: 0, currency: 'KZT', quantity_total: 100,
    quantity_sold: 30, quantity_reserved: 5, is_hidden: false },
  { id: 2, name: 'Staff', description: null, price_minor: 0, currency: 'KZT', quantity_total: 10,
    quantity_sold: 0, quantity_reserved: 0, is_hidden: true },
];
const errorCode = (code) => (error) => error instanceof EventWorkflowError && error.code === code;

test('preview combines the server preview with visible ticket types and their availability', async () => {
  const fake = scriptApi([[200, preview], [200, types]]);
  const snapshot = await eventLifecycleApi.preview(1, 7);
  assert.deepEqual(fake.calls.map((c) => c.path), ['/organizer/events/7/preview', '/organizer/events/7/ticket-types']);
  assert.deepEqual(snapshot.gallery_images, ['http://x/g.png']);
  assert.deepEqual(snapshot.ticket_types.map((t) => [t.name, t.available]), [['General', 65]]);
  assert.deepEqual(snapshot.allowed_actions, ['publish', 'cancel']);
});

test('a transition posts the action and returns the fresh preview', async () => {
  const published = { ...preview, event: { ...event, status: 'published' }, allowed_actions: ['unpublish', 'cancel'] };
  const fake = scriptApi([[200, published.event], [200, published], [200, types]]);
  const snapshot = await eventLifecycleApi.transition(1, 7, 'publish');
  assert.deepEqual([fake.calls[0].method, fake.calls[0].path], ['POST', '/organizer/events/7/publish']);
  assert.equal(snapshot.event.status, 'published');
});

test('a refused publish carries the server reason as a requirements error', async () => {
  scriptApi([[409, { detail: 'starts_at must be in the future' }]]);
  await assert.rejects(eventLifecycleApi.transition(1, 7, 'publish'),
    (e) => errorCode('requirements')(e) && e.detail === 'starts_at must be in the future');
});

test('other refused transitions are conflicts, and unknown events are not found', async () => {
  scriptApi([[409, { detail: 'tickets are already sold or reserved; cancel the event instead' }]]);
  await assert.rejects(eventLifecycleApi.transition(1, 7, 'unpublish'), errorCode('conflict'));
  scriptApi([[404, { detail: 'Event not found' }], [404, { detail: 'Event not found' }]]);
  await assert.rejects(eventLifecycleApi.preview(1, 99), errorCode('notFound'));
});

test('network failures become load errors, never a fake empty list', async () => {
  scriptApi([[500, { detail: 'boom' }]]);
  await assert.rejects(eventLifecycleApi.list(1), errorCode('load'));
});
