import { ApiError, api } from "./auth";
import type { OrganizerEventRecord, ServerImage } from "./organizerEvents";

export type { EventStatus, OrganizerEventRecord } from "./organizerEvents";
export type EventAction = "publish" | "unpublish" | "cancel";
export type PublishRequirementCode = "title" | "venue" | "schedule" | "future_start" | "visible_ticket_type";

export type OrganizerTicketType = {
  id: number;
  event_id: number;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  quantity_total: number;
  quantity_sold: number;
  quantity_reserved: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  max_per_order: number | null;
  is_hidden: boolean;
  position: number;
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

type PreviewResponse = Omit<EventPreview, "gallery_images" | "ticket_types"> & { images: ServerImage[] };

export type WorkflowErrorCode = "load" | "save" | "notFound" | "conflict" | "requirements";

export class EventWorkflowError extends Error {
  code: WorkflowErrorCode;
  detail?: string;

  constructor(code: WorkflowErrorCode, detail?: string) {
    super(code);
    this.name = "EventWorkflowError";
    this.code = code;
    this.detail = detail;
  }
}

const base = (eventId: number) => `/organizer/events/${eventId}`;

const asWorkflowError = (error: unknown, fallback: WorkflowErrorCode, action?: EventAction) => {
  if (error instanceof EventWorkflowError) return error;
  if (error instanceof ApiError) {
    if (error.status === 404) return new EventWorkflowError("notFound");
    // The backend says exactly which publish guard failed; keep its words.
    if (error.status === 409) return new EventWorkflowError(action === "publish" ? "requirements" : "conflict", error.message);
  }
  return new EventWorkflowError(fallback);
};

// Hidden types are still the organizer's inventory, but the preview shows the
// event as attendees will see it, so they are left out here.
const toPreviewTypes = (types: OrganizerTicketType[]): PreviewTicketType[] => types
  .filter((type) => !type.is_hidden)
  .map(({ id, name, description, price_minor, currency, quantity_total, quantity_sold, quantity_reserved }) => ({
    id, name, description, price_minor, currency, available: quantity_total - quantity_sold - quantity_reserved,
  }));

export const eventLifecycleApi = {
  // Kept for the hooks' signature; the server is the shared state now, and
  // the preview query refetches on focus and on an interval.
  subscribe: (_userId: number, _onChange: () => void) => () => undefined,
  list: async (_userId: number): Promise<OrganizerEventRecord[]> => {
    try { return await api.get<OrganizerEventRecord[]>("/organizer/events"); }
    catch (error) { throw asWorkflowError(error, "load"); }
  },
  preview: async (_userId: number, eventId: number): Promise<EventPreview> => {
    try {
      const [preview, types] = await Promise.all([
        api.get<PreviewResponse>(`${base(eventId)}/preview`),
        api.get<OrganizerTicketType[]>(`${base(eventId)}/ticket-types`),
      ]);
      return {
        event: preview.event,
        gallery_images: preview.images.filter((image, index) => preview.event.cover_image_url
          ? image.url !== preview.event.cover_image_url : index > 0).map((image) => image.url),
        ticket_types: toPreviewTypes(types),
        publish_requirements: preview.publish_requirements,
        allowed_actions: preview.allowed_actions,
      };
    } catch (error) {
      throw asWorkflowError(error, "load");
    }
  },
  transition: async (userId: number, eventId: number, action: EventAction): Promise<EventPreview> => {
    try {
      await api.post<OrganizerEventRecord>(`${base(eventId)}/${action}`);
    } catch (error) {
      throw asWorkflowError(error, "save", action);
    }
    return eventLifecycleApi.preview(userId, eventId);
  },
  duplicate: async (eventId: number): Promise<OrganizerEventRecord> =>
    api.post<OrganizerEventRecord>(`${base(eventId)}/duplicate`),
};
