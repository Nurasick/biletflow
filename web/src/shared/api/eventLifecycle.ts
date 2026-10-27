import { resolveEventDateTime } from "../../features/Organizer/model/eventDateTime";
import type { OrganizerEventValues } from "../../features/Organizer/model/eventSchema";
import { organizerEventApi } from "./organizerEvents";

export type EventStatus = "draft" | "published" | "cancelled" | "suspended";
export type EventAction = "publish" | "unpublish" | "cancel";
export type PublishRequirementCode = "title" | "venue" | "schedule" | "future_start" | "visible_ticket_type";

export type OrganizerEventRecord = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: "concert" | "conference" | "sport" | "theater" | "other" | null;
  cover_image_url: string | null;
  status: EventStatus;
  visibility: "public" | "unlisted" | "private";
  venue_name: string;
  venue_address: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

export type PreviewTicketType = {
  id: number;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  available: number;
};

export type EventPreview = {
  event: OrganizerEventRecord;
  gallery_images: string[];
  ticket_types: PreviewTicketType[];
  publish_requirements: { code: PublishRequirementCode; met: boolean }[];
  allowed_actions: EventAction[];
};

type WorkflowRecord = {
  status: EventStatus;
  publishedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
};

type WorkflowStorage = {
  read: (userId: number) => unknown;
  write: (userId: number, record: WorkflowRecord) => void;
};

const storageKey = (userId: number) => `biletflow.demo.event-workflow.${userId}`;
const browserStorage: WorkflowStorage = {
  read: (userId) => {
    const value = localStorage.getItem(storageKey(userId));
    return value === null ? undefined : JSON.parse(value);
  },
  write: (userId, record) => localStorage.setItem(storageKey(userId), JSON.stringify(record)),
};

export type WorkflowErrorCode = "load" | "save" | "notFound" | "conflict" | "requirements";

export class EventWorkflowError extends Error {
  code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode) {
    super(code);
    this.name = "EventWorkflowError";
    this.code = code;
  }
}

const allowedActions = (status: EventStatus, requirements: EventPreview["publish_requirements"]): EventAction[] =>
  status === "draft" ? [...(requirements.every(({ met }) => met) ? ["publish" as const] : []), "cancel"]
    : status === "published" ? ["unpublish", "cancel"] : [];

// The organizer workspace is a frontend demo. A visible free ticket type is a
// fixture, not inventory created on the backend. Adapters return whole snapshots
// so the UI never guesses whether an action succeeded.
export const EVENT_WORKFLOW_DEMO = {
  errors: { load: false, publish: false, unpublish: false, cancel: false },
  ticketTypes: [{
    id: 1, name: "General admission", description: null,
    price_minor: 0, currency: "KZT", available: 100,
  }] as PreviewTicketType[],
};

const dateTime = (value: string, zone: string) =>
  new Date(resolveEventDateTime(value, zone)[0]).toISOString();

const readRecord = (value: unknown): WorkflowRecord | undefined => {
  if (value === undefined) return undefined;
  const record = value as WorkflowRecord | null;
  if (!record || !["draft", "published", "cancelled", "suspended"].includes(record.status)
    || !Number.isFinite(Date.parse(record.updatedAt))
    || ![record.publishedAt, record.cancelledAt].every((date) => date === null || (typeof date === "string" && Number.isFinite(Date.parse(date))))) {
    throw new EventWorkflowError("load");
  }
  return record;
};

export const createEventLifecycleApi = ({
  storage = browserStorage,
  getDraft = organizerEventApi.getDraft,
  now = () => new Date(),
  getTicketTypes = () => structuredClone(EVENT_WORKFLOW_DEMO.ticketTypes),
}: {
  storage?: WorkflowStorage;
  getDraft?: (userId: number) => Promise<OrganizerEventValues>;
  now?: () => Date;
  getTicketTypes?: () => PreviewTicketType[];
} = {}) => {
  const snapshot = async (userId: number, eventId: number): Promise<EventPreview> => {
    try {
      const draft = await getDraft(userId);
      if (eventId !== 1 || !draft.title) throw new EventWorkflowError("notFound");
      if (EVENT_WORKFLOW_DEMO.errors.load) throw new EventWorkflowError("load");
      const record = readRecord(storage.read(userId));
      const event: OrganizerEventRecord = {
        id: 1, slug: "demo-event", title: draft.title, description: draft.description,
        category: draft.category, cover_image_url: draft.images[0]?.dataUrl ?? null,
        venue_name: draft.venueName, venue_address: draft.venueAddress,
        starts_at: dateTime(draft.startsAt, draft.timeZone), ends_at: dateTime(draft.endsAt, draft.timeZone),
        timezone: draft.timeZone, capacity: draft.capacity ? Number(draft.capacity) : null,
        registration_opens_at: draft.registrationOpensAt ? dateTime(draft.registrationOpensAt, draft.timeZone) : null,
        registration_closes_at: draft.registrationClosesAt ? dateTime(draft.registrationClosesAt, draft.timeZone) : null,
        visibility: draft.visibility, status: record?.status ?? "draft",
        published_at: record?.publishedAt ?? null, cancelled_at: record?.cancelledAt ?? null,
        updated_at: record?.updatedAt ?? now().toISOString(),
      };
      const ticket_types = getTicketTypes();
      const publish_requirements: EventPreview["publish_requirements"] = [
        { code: "title", met: Boolean(draft.title.trim()) },
        { code: "venue", met: Boolean(draft.venueName.trim() && draft.venueAddress.trim()) },
        { code: "schedule", met: Date.parse(event.ends_at) > Date.parse(event.starts_at) },
        { code: "future_start", met: Date.parse(event.starts_at) > now().getTime() },
        { code: "visible_ticket_type", met: ticket_types.length > 0 },
      ];
      return {
        event, gallery_images: draft.images.slice(1).map((image) => image.dataUrl), ticket_types,
        publish_requirements, allowed_actions: allowedActions(event.status, publish_requirements),
      };
    } catch (error) {
      if (error instanceof EventWorkflowError) throw error;
      throw new EventWorkflowError("load");
    }
  };

  return {
    subscribe: (userId: number, onChange: () => void) => {
      const listener = (event: StorageEvent) => {
        if (event.key === null || event.key === storageKey(userId)) onChange();
      };
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
    list: async (userId: number): Promise<OrganizerEventRecord[]> => {
      try { return [(await snapshot(userId, 1)).event]; }
      catch (error) {
        if (error instanceof EventWorkflowError && error.code === "notFound") return [];
        throw error;
      }
    },
    preview: snapshot,
    transition: async (userId: number, eventId: number, action: EventAction): Promise<EventPreview> => {
      const current = await snapshot(userId, eventId);
      // Re-read immediately before the synchronous write to catch other tabs.
      const stored = readRecord(storage.read(userId));
      if (stored && stored.status !== current.event.status) throw new EventWorkflowError("conflict");
      if (!current.allowed_actions.includes(action)) {
        throw new EventWorkflowError(action === "publish" && current.event.status === "draft" ? "requirements" : "conflict");
      }
      const timestamp = now().toISOString();
      const record: WorkflowRecord = {
        status: action === "publish" ? "published" : action === "unpublish" ? "draft" : "cancelled",
        publishedAt: action === "publish" ? timestamp : action === "unpublish" ? null : current.event.published_at,
        cancelledAt: action === "cancel" ? timestamp : null,
        updatedAt: timestamp,
      };
      try {
        if (EVENT_WORKFLOW_DEMO.errors[action]) throw new Error();
        storage.write(userId, record);
      } catch { throw new EventWorkflowError("save"); }
      return {
        ...current,
        event: { ...current.event, status: record.status, published_at: record.publishedAt,
          cancelled_at: record.cancelledAt, updated_at: record.updatedAt },
        allowed_actions: allowedActions(record.status, current.publish_requirements),
      };
    },
  };
};

export const eventLifecycleApi = createEventLifecycleApi();
