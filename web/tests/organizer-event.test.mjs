import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const dateTimeUrl = await moduleUrl('../src/features/Organizer/model/eventDateTime.ts');
const schemaUrl = await moduleUrl('../src/features/Organizer/model/eventSchema.ts', {
  '"zod"': JSON.stringify(import.meta.resolve('zod')),
  '"./eventDateTime"': JSON.stringify(dateTimeUrl),
});
const imageUrl = await moduleUrl('../src/features/Organizer/model/eventImages.ts', {
  '"./eventSchema"': JSON.stringify(schemaUrl),
});
const apiUrl = await moduleUrl('../src/shared/api/organizerEvents.ts', {
  '"../../features/Organizer/model/eventDateTime"': JSON.stringify(dateTimeUrl),
  '"../../features/Organizer/model/eventSchema"': JSON.stringify(schemaUrl),
  '"./auth"': JSON.stringify(fakeAuthUrl),
});
const { parseLocalDateTime, resolveEventDateTime, isEventTimeZone, toLocalDateTime } = await import(dateTimeUrl);
const { emptyOrganizerEvent, eventSchema, MAX_IMAGE_BYTES } = await import(schemaUrl);
const { validateEventImageFiles, readEventImage } = await import(imageUrl);
const { organizerEventApi, OrganizerEventError } = await import(apiUrl);


const validDraft = () => ({
  ...emptyOrganizerEvent(),
  title: 'Indie Night', description: 'An evening of live music.', category: 'concert',
  venueName: 'Music Hall', venueAddress: '56 Dostyk Ave, Almaty',
  startsAt: '2027-04-18T19:00', endsAt: '2027-04-18T22:00',
  registrationOpensAt: '2027-04-01T09:00', registrationClosesAt: '2027-04-18T18:00',
  capacity: '250', visibility: 'unlisted',
});

const errorAt = (patch, field, message) => {
  const result = eventSchema.safeParse({ ...validDraft(), ...patch });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path[0] === field && issue.message === message),
    JSON.stringify(result.error.issues));
};

test('event details are trimmed and optional images, capacity and registration boundaries are accepted', () => {
  const parsed = eventSchema.parse({ ...validDraft(), title: ' Indie Night ', description: ' Music. ', capacity: ' ' });
  assert.equal(parsed.title, 'Indie Night');
  assert.equal(parsed.description, 'Music.');
  assert.equal(parsed.capacity, '');
  for (const registration of [
    { registrationOpensAt: '', registrationClosesAt: '' },
    { registrationOpensAt: '' }, { registrationClosesAt: '' },
    { registrationClosesAt: validDraft().startsAt },
  ]) assert.equal(eventSchema.safeParse({ ...validDraft(), ...registration }).success, true);
});

test('required fields, lengths, category, capacity and visibility are validated', () => {
  for (const [patch, field, message] of [
    [{ title: ' ' }, 'title', 'validation.eventTitle'],
    [{ title: 'x'.repeat(301) }, 'title', 'validation.eventTitleMax'],
    [{ description: ' ' }, 'description', 'validation.eventDescription'],
    [{ description: 'x'.repeat(10001) }, 'description', 'validation.eventDescriptionMax'],
    [{ venueName: '' }, 'venueName', 'validation.eventVenue'],
    [{ venueName: 'x'.repeat(301) }, 'venueName', 'validation.eventVenueMax'],
    [{ venueAddress: '' }, 'venueAddress', 'validation.eventAddress'],
    [{ venueAddress: 'x'.repeat(2001) }, 'venueAddress', 'validation.eventAddressMax'],
    [{ category: 'invalid' }, 'category', 'validation.eventCategory'],
    [{ visibility: 'invalid' }, 'visibility', 'validation.eventVisibility'],
    [{ timeZone: '+05:00' }, 'timeZone', 'validation.eventTimeZone'],
    [{ timeZone: 'Mars/Olympus' }, 'timeZone', 'validation.eventTimeZone'],
  ]) errorAt(patch, field, message);
  for (const capacity of ['0', '-1', '1.5', '1e3', 'NaN', '2147483648', '20 people']) {
    errorAt({ capacity }, 'capacity', 'validation.eventCapacity');
  }
  assert.equal(eventSchema.safeParse({ ...validDraft(), capacity: '2147483647' }).success, true);
  for (const visibility of ['public', 'unlisted', 'private']) {
    assert.equal(eventSchema.safeParse({ ...validDraft(), visibility }).success, true);
  }
});

test('invalid calendar dates, missing times, reversed event and registration windows fail at the relevant field', () => {
  for (const value of ['', '2027-02-29T19:00', '2027-04-18', '2027-04-18T25:00', '0000-01-01T00:00']) {
    assert.equal(parseLocalDateTime(value), null);
    errorAt({ startsAt: value }, 'startsAt', 'validation.eventDateTime');
  }
  errorAt({ endsAt: validDraft().startsAt }, 'endsAt', 'validation.eventEndOrder');
  errorAt({ endsAt: '2027-04-17T22:00' }, 'endsAt', 'validation.eventEndOrder');
  errorAt({ registrationClosesAt: validDraft().registrationOpensAt }, 'registrationClosesAt', 'validation.eventRegistrationOrder');
  errorAt({ registrationClosesAt: '2027-04-19T00:00' }, 'registrationClosesAt', 'validation.eventRegistrationAfterStart');
  errorAt({ registrationOpensAt: '2027-04-19T00:00' }, 'registrationOpensAt', 'validation.eventRegistrationAfterStart');
});

test('time zone resolution uses the selected IANA zone, including fractional offsets and DST', () => {
  assert.equal(isEventTimeZone('UTC'), true);
  assert.equal(isEventTimeZone('Asia/Almaty'), true);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'Asia/Almaty'), [Date.parse('2027-04-18T14:00:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'Asia/Kathmandu'), [Date.parse('2027-04-18T13:15:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'UTC'), [Date.parse('2027-04-18T19:00:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-03-14T02:30', 'America/New_York'), []);
  assert.deepEqual(resolveEventDateTime('2027-11-07T01:30', 'America/New_York'), [
    Date.parse('2027-11-07T05:30:00Z'), Date.parse('2027-11-07T06:30:00Z'),
  ]);
  errorAt({ timeZone: 'America/New_York', startsAt: '2027-03-14T02:30' }, 'startsAt', 'validation.eventDateNonexistent');
  errorAt({ timeZone: 'America/New_York', registrationOpensAt: '2026-11-01T01:30' }, 'registrationOpensAt', 'validation.eventDateAmbiguous');
});

test('image selection rejects unsupported, empty, oversized and excessive files', () => {
  const file = { type: 'image/png', size: 100 };
  assert.equal(validateEventImageFiles([file], 0), null);
  assert.equal(validateEventImageFiles([file], 4), null);
  assert.equal(validateEventImageFiles([file], 5), 'validation.eventImageCount');
  assert.equal(validateEventImageFiles(Array(6).fill(file), 0), 'validation.eventImageCount');
  assert.equal(validateEventImageFiles([{ ...file, type: 'image/svg+xml' }], 0), 'validation.eventImageType');
  assert.equal(validateEventImageFiles([{ ...file, size: MAX_IMAGE_BYTES + 1 }], 0), 'validation.eventImageSize');
  assert.equal(validateEventImageFiles([{ ...file, size: 0 }], 0), 'validation.eventImageSize');
  assert.equal(validateEventImageFiles([{ ...file, size: MAX_IMAGE_BYTES }], 0), null);
  errorAt({ images: Array(6).fill({ id: 'id', name: 'image', dataUrl: 'data:image/png;base64,AAAA' }) }, 'images', 'validation.eventImageCount');
  assert.equal(eventSchema.safeParse({ ...validDraft(), images: [{ id: 'id', name: 'image', dataUrl: 'javascript:alert(1)' }] }).success, false);
});

test('image decoding failures are surfaced, including files that only claim to be images', async () => {
  const originalReader = globalThis.FileReader;
  const originalImage = globalThis.Image;
  try {
    globalThis.FileReader = class {
      readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload(); }
    };
    globalThis.Image = class { set src(_) { this.onerror(); } };
    await assert.rejects(readEventImage({ name: 'invalid.png' }));
    globalThis.FileReader = class { readAsDataURL() { this.onerror(); } };
    await assert.rejects(readEventImage({ name: 'unreadable.png' }));
  } finally {
    globalThis.FileReader = originalReader;
    globalThis.Image = originalImage;
  }
});


// --- the API adapter (audit #5, #11: real events, addressed by id) ----------

const record = (overrides = {}) => ({
  id: 7, slug: 'indie-night', title: 'Indie Night', description: 'Live.', category: 'concert',
  cover_image_url: null, status: 'draft', phase: 'draft', visibility: 'unlisted',
  venue_name: 'Music Hall', venue_address: '56 Dostyk Ave, Almaty',
  starts_at: '2027-04-18T14:00:00Z', ends_at: '2027-04-18T17:00:00Z', timezone: 'Asia/Almaty',
  capacity: 250, registration_opens_at: null, registration_closes_at: null, refund_policy: null,
  published_at: null, cancelled_at: null, updated_at: '2027-01-01T00:00:00Z', ...overrides,
});

test('an instant from the API is shown as wall-clock time in the event zone', () => {
  assert.equal(toLocalDateTime('2027-04-18T14:00:00Z', 'Asia/Almaty'), '2027-04-18T19:00');
  assert.equal(toLocalDateTime('2027-04-18T13:15:00Z', 'Asia/Kathmandu'), '2027-04-18T19:00');
  for (const zone of ['UTC', 'Asia/Almaty', 'America/New_York']) {
    const local = '2027-06-01T08:30';
    const [instant] = resolveEventDateTime(local, zone);
    assert.equal(toLocalDateTime(new Date(instant).toISOString(), zone), local);
  }
});

test('creating sends UTC instants resolved in the event zone, then uploads new images', async () => {
  const fake = scriptApi([[201, record()], [200, []], [201, { id: 1, url: 'http://x/1.png', position: 0 }],
    [200, record({ cover_image_url: 'http://x/1.png' })]]);
  const id = await organizerEventApi.create({
    ...validDraft(), timeZone: 'Asia/Almaty',
    images: [{ id: 'new', name: 'cover.png', dataUrl: 'data:image/png;base64,AAAA' }],
  });
  assert.equal(id, 7);
  const [create, list, upload] = fake.calls;
  assert.deepEqual([create.method, create.path], ['POST', '/events']);
  assert.equal(create.body.starts_at, '2027-04-18T14:00:00.000Z');
  assert.equal(create.body.capacity, 250);
  assert.equal(create.body.registration_opens_at, '2027-04-01T04:00:00.000Z');
  assert.deepEqual([list.method, list.path], ['GET', '/organizer/events/7/images']);
  assert.deepEqual(upload.body, { data_url: 'data:image/png;base64,AAAA' });
  assert.deepEqual(fake.calls[3].body, { cover_image_url: 'http://x/1.png' });
});

test('loading maps stored images to server ids so a save keeps or deletes them', async () => {
  const images = [{ id: 11, url: 'http://x/a.png', position: 0 }, { id: 12, url: 'http://x/b.png', position: 1 }];
  scriptApi([[200, record({ cover_image_url: images[0].url })], [200, images]]);
  const { values } = await organizerEventApi.get(7);
  assert.equal(values.startsAt, '2027-04-18T19:00');
  assert.deepEqual(values.images.map((i) => i.id), ['server-11', 'server-12']);
  assert.equal(eventSchema.safeParse(values).success, true);

  const saved = record({ cover_image_url: images[0].url });
  const fake = scriptApi([[200, saved], [200, images], [204, null], [200, saved], [200, saved], [200, [images[0]]]]);
  await organizerEventApi.update(7, { ...values, images: [values.images[0]] });
  assert.deepEqual(fake.calls.map((c) => [c.method, c.path]), [
    ['PATCH', '/organizer/events/7'], ['GET', '/organizer/events/7/images'],
    ['DELETE', '/organizer/events/7/images/12'], ['PATCH', '/organizer/events/7'],
    ['GET', '/organizer/events/7'], ['GET', '/organizer/events/7/images'],
  ]);
});

test('not found and frozen events surface as typed errors', async () => {
  scriptApi([[404, { detail: 'Event not found' }], [200, []]]);
  await assert.rejects(organizerEventApi.get(99), (e) => e instanceof OrganizerEventError && e.message === 'organizerEvent.accessError');
  scriptApi([[409, { detail: 'A cancelled event cannot be edited' }]]);
  await assert.rejects(organizerEventApi.update(7, validDraft()),
    (e) => e instanceof OrganizerEventError && e.message === 'organizerEvent.notEditable');
});

test('editing persists the selected existing cover and refund policy without re-uploading images', async () => {
  const images = [{ id: 11, url: 'http://x/a.png', position: 0 }, { id: 12, url: 'http://x/b.png', position: 1 }];
  const original = record({ status: 'published', cover_image_url: images[0].url });
  const saved = record({ ...original, refund_policy: 'Full refund until one week before the event.', cover_image_url: images[1].url });
  const fake = scriptApi([[200, original], [200, images], [200, saved], [200, saved], [200, images]]);
  const values = await organizerEventApi.update(7, {
    ...validDraft(), refundPolicy: '  Full refund until one week before the event.  ',
    images: [images[1], images[0]].map((image) => ({ id: `server-${image.id}`, name: 'image.png', dataUrl: image.url })),
  });
  assert.equal(fake.calls[0].body.refund_policy, saved.refund_policy);
  assert.equal(Object.hasOwn(fake.calls[0].body, 'status'), false);
  assert.deepEqual(fake.calls[2], { method: 'PATCH', path: '/organizer/events/7', body: { cover_image_url: images[1].url } });
  assert.equal(fake.calls.some((call) => call.method === 'POST' || call.method === 'DELETE'), false);
  assert.equal(values.images[0].id, 'server-12');
  assert.equal(values.refundPolicy, saved.refund_policy);
});

test('refund policy can be cleared, and overlong policy text is rejected before saving', async () => {
  const fake = scriptApi([[200, record()], [200, []], [200, record()], [200, []]]);
  const saved = await organizerEventApi.update(7, { ...validDraft(), refundPolicy: ' ' });
  assert.equal(fake.calls[0].body.refund_policy, null);
  assert.equal(saved.refundPolicy, '');
  errorAt({ refundPolicy: 'x'.repeat(2001) }, 'refundPolicy', 'validation.eventRefundPolicyMax');
});

test('server validation errors remain available to the edit form, and changed images fail explicitly', async () => {
  scriptApi([[422, { detail: 'capacity must cover existing registrations' }]]);
  await assert.rejects(organizerEventApi.update(7, validDraft()),
    (error) => error.status === 422 && error.message.includes('capacity'));
  const fake = scriptApi([[200, record()], [200, []]]);
  await assert.rejects(organizerEventApi.update(7, { ...validDraft(), images: [
    { id: 'server-99', name: 'deleted.png', dataUrl: 'http://x/deleted.png' },
  ] }), (error) => error instanceof OrganizerEventError && error.message === 'eventEdit.imagesChanged');
  assert.equal(fake.calls.length, 2);
});
