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
  venue_name: string;
  venue_address: string;
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

export type ServerImage = { id: number; url: string; position: number };

export class OrganizerEventError extends Error {
  constructor(message: "organizerEvent.loadError" | "organizerEvent.saveError" | "organizerEvent.accessError"
    | "organizerEvent.notEditable") {
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
  category: values.category,
  venue_name: values.venueName,
  venue_address: values.venueAddress,
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
    category: event.category ?? "other",
    images: images.map((image) => ({
      id: `${SERVER_IMAGE}${image.id}`, name: `image-${image.position + 1}`, dataUrl: image.url,
    })),
    venueName: event.venue_name,
    venueAddress: event.venue_address,
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

/** Make the server's images match the form: delete removed ones, upload new ones. */
const syncImages = async (eventId: number, images: EventImage[]) => {
  const stored = await api.get<ServerImage[]>(`${path(eventId)}/images`);
  const kept = new Set(images.filter((i) => i.id.startsWith(SERVER_IMAGE)).map((i) => Number(i.id.slice(SERVER_IMAGE.length))));
  for (const image of stored) {
    if (!kept.has(image.id)) await api.delete<null>(`${path(eventId)}/images/${image.id}`);
  }
  for (const image of images) {
    if (image.dataUrl.startsWith("data:")) {
      await api.post<ServerImage>(`${path(eventId)}/images`, { data_url: image.dataUrl });
    }
  }
};

const wrap = async <T>(code: "organizerEvent.loadError" | "organizerEvent.saveError", run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OrganizerEventError) throw error;
    if (error instanceof ApiError && error.status === 404) throw new OrganizerEventError("organizerEvent.accessError");
    if (error instanceof ApiError && error.status === 409) throw new OrganizerEventError("organizerEvent.notEditable");
    throw new OrganizerEventError(code);
  }
};

export const organizerEventApi = {
  empty: emptyOrganizerEvent,
  get: (eventId: number) => wrap("organizerEvent.loadError", async () => {
    const [event, images] = await Promise.all([
      api.get<OrganizerEventRecord>(path(eventId)),
      api.get<ServerImage[]>(`${path(eventId)}/images`),
    ]);
    return { event, values: toValues(event, images) };
  }),
  /** Create a draft (the server makes the slug from the title). Returns its id. */
  create: (values: OrganizerEventValues) => wrap("organizerEvent.saveError", async () => {
    const draft = eventSchema.parse(values);
    const event = await api.post<OrganizerEventRecord>("/events", toBody(draft));
    await syncImages(event.id, draft.images);
    return event.id;
  }),
  update: (eventId: number, values: OrganizerEventValues) => wrap("organizerEvent.saveError", async () => {
    const draft = eventSchema.parse(values);
    await api.patch<OrganizerEventRecord>(path(eventId), toBody(draft));
    await syncImages(eventId, draft.images);
    return (await organizerEventApi.get(eventId)).values;
  }),
};
