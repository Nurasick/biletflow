import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const dateTimeUrl = await moduleUrl('../src/features/Organizer/model/eventDateTime.ts');
const draftApiUrl = `data:text/javascript;base64,${Buffer.from('export const organizerEventApi = {};').toString('base64')}`;
const lifecycleUrl = await moduleUrl('../src/shared/api/eventLifecycle.ts', {
  '"../../features/Organizer/model/eventDateTime"': JSON.stringify(dateTimeUrl),
  '"./organizerEvents"': JSON.stringify(draftApiUrl),
});
const { createEventLifecycleApi, EventWorkflowError, EVENT_WORKFLOW_DEMO } = await import(lifecycleUrl);

const draft = () => ({
  title: 'Indie Night', description: '<b>Live music</b>', category: 'concert',
  venueName: 'Music Hall', venueAddress: '56 Dostyk Ave, Almaty',
  startsAt: '2030-11-30T19:00', endsAt: '2030-11-30T22:00', timeZone: 'Asia/Almaty',
  registrationOpensAt: '', registrationClosesAt: '', capacity: '250', visibility: 'unlisted',
  images: [{ id: 'cover', name: 'cover.png', dataUrl: 'data:image/png;base64,AAAA' },
    { id: 'gallery', name: 'gallery.png', dataUrl: 'data:image/png;base64,BBBB' }],
});
const clock = new Date('2030-11-29T10:00:00Z');
const statusRecord = (status) => ({ status, publishedAt: null, cancelledAt: null, updatedAt: clock.toISOString() });
const errorCode = (code) => (error) => error instanceof EventWorkflowError && error.code === code;

function setup({ records = new Map(), values = draft(), ticketTypes = EVENT_WORKFLOW_DEMO.ticketTypes, storage, now } = {}) {
  const persistence = storage ?? {
    read: (id) => structuredClone(records.get(id)),
    write: (id, record) => records.set(id, structuredClone(record)),
  };
  const api = createEventLifecycleApi({
    storage: persistence,
    getDraft: async (userId) => { assert.equal(userId, 1); return structuredClone(values); },
    now: now ?? (() => new Date(clock)),
    getTicketTypes: () => structuredClone(ticketTypes),
  });
  return { api, records, values };
}

test('preview uses only saved details, preserves images and visibility, and resolves the event time zone', async () => {
  const { api, values } = setup();
  const snapshot = await api.preview(1, 1);
  assert.equal(snapshot.event.status, 'draft');
  assert.equal(snapshot.event.title, values.title);
  assert.equal(snapshot.event.description, '<b>Live music</b>');
  assert.equal(snapshot.event.visibility, 'unlisted');
  assert.equal(snapshot.event.starts_at, '2030-11-30T14:00:00.000Z');
  assert.equal(snapshot.event.cover_image_url, values.images[0].dataUrl);
  assert.deepEqual(snapshot.gallery_images, [values.images[1].dataUrl]);
  assert.deepEqual(snapshot.allowed_actions, ['publish', 'cancel']);
  assert.ok(snapshot.publish_requirements.every(({ met }) => met));
  assert.equal((await api.list(1))[0].id, 1);
});

test('every status/action pair follows the lifecycle and illegal transitions preserve storage', async () => {
  const legal = {
    draft: { publish: 'published', cancel: 'cancelled' },
    published: { unpublish: 'draft', cancel: 'cancelled' },
    cancelled: {}, suspended: {},
  };
  for (const [status, actions] of Object.entries(legal)) {
    for (const action of ['publish', 'unpublish', 'cancel']) {
      const records = new Map([[1, statusRecord(status)]]);
      const { api } = setup({ records });
      if (action in actions) {
        const result = await api.transition(1, 1, action);
        assert.equal(result.event.status, actions[action], `${status} -> ${action}`);
        assert.equal((await setup({ records }).api.preview(1, 1)).event.status, actions[action]);
        if (action === 'publish') assert.equal(result.event.published_at, clock.toISOString());
        if (action === 'unpublish') assert.equal(result.event.published_at, null);
        if (action === 'cancel') assert.equal(result.event.cancelled_at, clock.toISOString());
        assert.equal(result.event.title, draft().title);
      } else {
        const before = structuredClone(records.get(1));
        await assert.rejects(api.transition(1, 1, action), errorCode('conflict'));
        assert.deepEqual(records.get(1), before);
      }
    }
  }
});

test('past or exact-start events and missing visible tickets explain why publishing is blocked', async () => {
  for (const options of [
    { now: () => new Date('2030-11-30T14:00:00Z') },
    { now: () => new Date('2030-12-01T00:00:00Z') },
    { ticketTypes: [] },
  ]) {
    const { api, records } = setup(options);
    const snapshot = await api.preview(1, 1);
    assert.ok(snapshot.publish_requirements.some(({ met }) => !met));
    assert.ok(!snapshot.allowed_actions.includes('publish'));
    await assert.rejects(api.transition(1, 1, 'publish'), errorCode('requirements'));
    assert.equal(records.size, 0);
  }
});

test('publishing rechecks current requirements instead of trusting an earlier preview', async () => {
  const ticketTypes = [...EVENT_WORKFLOW_DEMO.ticketTypes];
  const { api, records } = setup({ ticketTypes });
  assert.ok((await api.preview(1, 1)).allowed_actions.includes('publish'));
  ticketTypes.length = 0;
  await assert.rejects(api.transition(1, 1, 'publish'), errorCode('requirements'));
  assert.equal(records.size, 0);
});

test('unpublishing an event that has started returns a blocked draft', async () => {
  const { api } = setup({ records: new Map([[1, statusRecord('published')]]), now: () => new Date('2030-12-01T00:00:00Z') });
  const snapshot = await api.transition(1, 1, 'unpublish');
  assert.equal(snapshot.event.status, 'draft');
  assert.deepEqual(snapshot.allowed_actions, ['cancel']);
});

test('failed writes never change the status, and retry succeeds', async () => {
  let fail = true;
  let record = statusRecord('draft');
  const { api } = setup({ storage: {
    read: () => structuredClone(record),
    write: (_, value) => { if (fail) throw new Error('Quota exceeded'); record = structuredClone(value); },
  } });
  await assert.rejects(api.transition(1, 1, 'publish'), errorCode('save'));
  assert.equal((await api.preview(1, 1)).event.status, 'draft');
  fail = false;
  assert.equal((await api.transition(1, 1, 'publish')).event.status, 'published');
});

test('concurrent transitions produce a single winner and later reads see the persisted result', async () => {
  const { api, records } = setup();
  const results = await Promise.allSettled([api.transition(1, 1, 'publish'), api.transition(1, 1, 'cancel')]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal((await api.preview(1, 1)).event.status, records.get(1).status);
});

test('unknown events, empty drafts and corrupt state are not mistaken for a fresh draft', async () => {
  const { api } = setup();
  await assert.rejects(api.preview(1, 2), errorCode('notFound'));
  await assert.rejects(api.preview(1, NaN), errorCode('notFound'));
  const empty = setup({ values: { ...draft(), title: '' } }).api;
  assert.deepEqual(await empty.list(1), []);
  await assert.rejects(empty.preview(1, 1), errorCode('notFound'));
  for (const record of [null, {}, { ...statusRecord('draft'), status: 'unknown' }, { ...statusRecord('draft'), updatedAt: 'invalid' }]) {
    const records = new Map([[1, record]]);
    const corrupt = setup({ records }).api;
    await assert.rejects(corrupt.preview(1, 1), errorCode('load'));
    await assert.rejects(corrupt.transition(1, 1, 'publish'), errorCode('load'));
    assert.deepEqual(records.get(1), record);
  }
});

test('demo failures preserve data and can be cleared for retry', async () => {
  const { api, records } = setup();
  EVENT_WORKFLOW_DEMO.errors.load = true;
  try { await assert.rejects(api.preview(1, 1), errorCode('load')); }
  finally { EVENT_WORKFLOW_DEMO.errors.load = false; }
  EVENT_WORKFLOW_DEMO.errors.publish = true;
  try { await assert.rejects(api.transition(1, 1, 'publish'), errorCode('save')); }
  finally { EVENT_WORKFLOW_DEMO.errors.publish = false; }
  assert.equal(records.size, 0);
  assert.equal((await api.transition(1, 1, 'publish')).event.status, 'published');
});
