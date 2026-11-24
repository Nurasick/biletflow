import { resolveEventDateTime, toLocalDateTime } from "../../features/Organizer/model/eventDateTime";
import { emptyOrganizerEvent, eventSchema } from "../../features/Organizer/model/eventSchema";
import type { EventImage, OrganizerEventValues } from "../../features/Organizer/model/eventSchema";
import { ApiError, api } from "./auth";

export type EventStatus = "draft" | "published" | "cancelled" | "suspended";
export type EventPhase = "draft" | "upcoming" | "active" | "completed" | "cancelled" | "suspended";

export type OrganizerEventRecord = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: "concert" | "conference" | "sport" | "theater" | "other" | null;
  cover_image_url: string | null;
  status: EventStatus;
  phase: EventPhase;
  visibility: "public" | "unlisted" | "private";
  seating_mode: "general_admission" | "assigned";
  venue_id: number | null;
  venue_name: string;
  venue_address: string;
  venue_city: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  refund_policy: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

export type ServerImage = { id: number; url: string; position: number; alt_text: string | null };

export class OrganizerEventError extends Error {
  constructor(message: "organizerEvent.loadError" | "organizerEvent.saveError" | "organizerEvent.accessError"
    | "organizerEvent.notEditable" | "eventEdit.imagesChanged") {
    super(message);
    this.name = "OrganizerEventError";
  }
}

const SERVER_IMAGE = "server-";

const instant = (value: string, zone: string) => {
  const [match] = resolveEventDateTime(value, zone);
  return new Date(match).toISOString();
};
const optionalInstant = (value: string, zone: string) => (value ? instant(value, zone) : null);

/** Form values -> the API body. The schema has already resolved every time. */
const toBody = (values: OrganizerEventValues) => ({
  title: values.title,
  description: values.description,
  refund_policy: values.refundPolicy || null,
  category: values.category,
  venue_name: values.venueName,
  venue_address: values.venueAddress,
  // The API rejects an empty city; null clears it.
  venue_city: values.venueCity || null,
  seating_mode: values.seatingMode,
  timezone: values.timeZone,
  starts_at: instant(values.startsAt, values.timeZone),
  ends_at: instant(values.endsAt, values.timeZone),
  registration_opens_at: optionalInstant(values.registrationOpensAt, values.timeZone),
  registration_closes_at: optionalInstant(values.registrationClosesAt, values.timeZone),
  capacity: values.capacity ? Number(values.capacity) : null,
  visibility: values.visibility,
});

const toValues = (event: OrganizerEventRecord, images: ServerImage[]): OrganizerEventValues => {
  const local = (iso: string | null) => (iso ? toLocalDateTime(iso, event.timezone) : "");
  return {
    title: event.title,
    description: event.description ?? "",
    refundPolicy: event.refund_policy ?? "",
    category: event.category ?? "other",
    // Position 0 is the cover (the server keeps cover_image_url in step with it).
    images: [...images].sort((a, b) => a.position - b.position || a.id - b.id).map((image) => ({
      id: `${SERVER_IMAGE}${image.id}`, name: `image-${image.position + 1}`, dataUrl: image.url, alt: image.alt_text ?? "",
    })),
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    venueCity: event.venue_city ?? "",
    seatingMode: event.seating_mode ?? "general_admission",
    timeZone: event.timezone,
    startsAt: local(event.starts_at),
    endsAt: local(event.ends_at),
    registrationOpensAt: local(event.registration_opens_at),
    registrationClosesAt: local(event.registration_closes_at),
    capacity: event.capacity === null ? "" : String(event.capacity),
    visibility: event.visibility,
  };
};

const path = (eventId: number) => `/organizer/events/${eventId}`;

const altText = (image: EventImage) => image.alt?.trim() || null;
const serverId = (image: EventImage) => Number(image.id.slice(SERVER_IMAGE.length));

/** Make the server's images match the form: delete removed ones, update alt
 * text, upload new ones, then store the form's order (position 0 is the cover). */
const syncImages = async (event: OrganizerEventRecord, images: EventImage[]) => {
  const eventId = event.id;
  const stored = [...await api.get<ServerImage[]>(`${path(eventId)}/images`)]
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const byId = new Map(stored.map((image) => [image.id, image]));
  const keptImages = images.filter((i) => i.id.startsWith(SERVER_IMAGE));
  const kept = new Set(keptImages.map(serverId));
  if ([...kept].some((id) => !byId.has(id))) {
    throw new OrganizerEventError("eventEdit.imagesChanged");
  }
  let changed = false;
  for (const image of stored) {
    if (!kept.has(image.id)) {
      await api.delete<null>(`${path(eventId)}/images/${image.id}`);
      changed = true;
    }
  }
  for (const image of keptImages) {
    const alt = altText(image);
    if ((byId.get(serverId(image))?.alt_text ?? null) !== alt) {
      await api.patch<ServerImage>(`${path(eventId)}/images/${serverId(image)}`, { alt_text: alt });
    }
  }
  const order: ServerImage[] = [];
  const uploaded: ServerImage[] = [];
  for (const image of images) {
    if (image.dataUrl.startsWith("data:")) {
      const alt = altText(image);
      const added = await api.post<ServerImage>(`${path(eventId)}/images`, {
        data_url: image.dataUrl, ...(alt ? { alt_text: alt } : {}),
      });
      uploaded.push(added);
      order.push(added);
      changed = true;
    } else {
      order.push(byId.get(serverId(image))!);
    }
  }
  if (!order.length) return;
  // The server appends uploads after the kept images and moves the cover to
  // position 0 on every add or delete. Reorder only when the form differs, or
  // when nothing changed but a legacy cover URL is out of step.
  const serverOrder = [...stored.filter((image) => kept.has(image.id)), ...uploaded].map((image) => image.id);
  const wanted = order.map((image) => image.id);
  if (wanted.join() !== serverOrder.join() || (!changed && order[0].url !== event.cover_image_url)) {
    await api.put<ServerImage[]>(`${path(eventId)}/images/order`, { image_ids: wanted });
  }
};

const wrap = async <T>(code: "organizerEvent.loadError" | "organizerEvent.saveError", run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OrganizerEventError) throw error;
    if (error instanceof ApiError && [403, 404].includes(error.status)) throw new OrganizerEventError("organizerEvent.accessError");
    if (error instanceof ApiError && error.status === 409) throw new OrganizerEventError("organizerEvent.notEditable");
    if (error instanceof ApiError && error.status === 422) throw error;
    throw new OrganizerEventError(code);
  }
};

export const organizerEventApi = {
  empty: emptyOrganizerEvent,
  read: (eventId: number, signal?: AbortSignal) => api.get<OrganizerEventRecord>(path(eventId), { signal }),
  get: (eventId: number) => wrap("organizerEvent.loadError", async () => {
    const [event, images] = await Promise.all([
      organizerEventApi.read(eventId),
      api.get<ServerImage[]>(`${path(eventId)}/images`),
    ]);
    return { event, values: toValues(event, images) };
  }),
  /** Create a draft (the server makes the slug from the title). Returns its id. */
  create: (values: OrganizerEventValues) => wrap("organizerEvent.saveError", async () => {
    const draft = eventSchema.parse(values);
    const event = await api.post<OrganizerEventRecord>("/events", toBody(draft));
    await syncImages(event, draft.images);
    return event.id;
  }),
  update: (eventId: number, values: OrganizerEventValues) => wrap("organizerEvent.saveError", async () => {
    const draft = eventSchema.parse(values);
    const event = await api.patch<OrganizerEventRecord>(path(eventId), toBody(draft));
    await syncImages(event, draft.images);
    return (await organizerEventApi.get(eventId)).values;
  }),
};
