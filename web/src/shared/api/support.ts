import { api, optionalAuthFile, optionalAuthRequest } from "./auth";

export const caseCategories = [
  "ticket_delivery", "payment", "refund", "seating", "event_info", "check_in", "account", "activation", "technical",
] as const;
export const caseAudiences = ["attendee", "organizer"] as const;
export const caseStatuses = ["open", "in_progress", "waiting_for_customer", "resolved"] as const;

export type CaseCategory = (typeof caseCategories)[number];
export type CaseStatus = (typeof caseStatuses)[number];
export type StaffCaseStatus = Exclude<CaseStatus, "open">;
export type CaseAudience = (typeof caseAudiences)[number];

/** Which categories a requester may pick: organizers ask the platform about
 * their account and paid sales, attendees ask an organizer about an event. */
export const audienceCategories: Record<CaseAudience, readonly CaseCategory[]> = {
  attendee: ["ticket_delivery", "payment", "refund", "seating", "event_info", "check_in", "account", "technical"],
  organizer: ["account", "activation", "payment", "technical"],
};

/** Attachment types and size the backend accepts (storage.py, MAX_IMAGE_BYTES). */
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

export type CaseAttachment = {
  id: number;
  support_message_id: number | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

export type CaseTarget =
  | { audience: "attendee"; event_id: number; order_number?: string; ticket_code?: string; order_token?: string }
  | { audience: "organizer"; event_id?: number };

export type CaseInput = CaseTarget & { category: CaseCategory; body: string; contact_email?: string };

export type CaseContext = {
  event_id: number | null;
  event_title: string | null;
  order_number: string | null;
  ticket_code: string | null;
};

export type CaseSummary = {
  case_number: string;
  audience: CaseAudience;
  category: CaseCategory;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type CaseMessage = {
  id: number;
  sender: "requester" | "staff" | "system";
  body: string;
  created_at: string;
};

export type RequesterCase = CaseSummary & { context: CaseContext; messages: CaseMessage[]; attachments?: CaseAttachment[] };
type CreatedCase = RequesterCase & { access_token: string | null };

export type StaffCaseSummary = CaseSummary & {
  contact_email: string;
  opened_by_user_id: number | null;
  assigned_to_user_id: number | null;
  event_id: number | null;
  is_escalated?: boolean;
  escalated_at?: string | null;
  escalated_by_user_id?: number | null;
  escalation_reason?: string | null;
};

export type StaffMessage = CaseMessage & { author_user_id: number | null; is_internal_note: boolean };
export type StaffCase = StaffCaseSummary & { context: CaseContext; messages: StaffMessage[]; attachments?: CaseAttachment[] };
export type StaffCaseUpdate = { status?: StaffCaseStatus; assigned_to_user_id?: number | null };
export type QueueFilters = {
  status?: CaseStatus;
  category?: CaseCategory;
  eventId?: number;
  audience?: CaseAudience;
  escalated?: boolean;
  query?: string;
};
export type AttachmentUpload = { filename: string; dataUrl: string; messageId?: number };

const attachmentBody = ({ filename, dataUrl, messageId }: AttachmentUpload) => ({
  filename, data_url: dataUrl, ...(messageId !== undefined && { support_message_id: messageId }),
});

const withToken = (path: string, token: string | null) =>
  token ? `${path}?${new URLSearchParams({ token })}` : path;
const requesterPath = (number: string) => `/support/cases/${encodeURIComponent(number)}`;
const staffPath = (number: string) => `/staff/support/cases/${encodeURIComponent(number)}`;

export const requesterCaseHref = (number: string, token: string | null) =>
  withToken(`/support/${encodeURIComponent(number)}`, token);

export const supportApi = {
  open: (input: CaseInput, signedIn: boolean) => signedIn
    ? api.post<CreatedCase>("/support/cases", input)
    : optionalAuthRequest<CreatedCase>("/support/cases", api.json("POST", input)),
  mine: (signal?: AbortSignal) => api.get<CaseSummary[]>("/support/cases", { signal }),
  case: (number: string, token: string | null, signal?: AbortSignal) =>
    optionalAuthRequest<RequesterCase>(withToken(requesterPath(number), token), { signal }),
  reply: (number: string, token: string | null, body: string) =>
    optionalAuthRequest<RequesterCase>(withToken(`${requesterPath(number)}/messages`, token), api.json("POST", { body })),
  attach: (number: string, token: string | null, upload: AttachmentUpload) =>
    optionalAuthRequest<CaseAttachment>(withToken(`${requesterPath(number)}/attachments`, token),
      api.json("POST", attachmentBody(upload))),
  attachmentFile: (number: string, token: string | null, attachmentId: number, mediaType: string) =>
    optionalAuthFile(withToken(`${requesterPath(number)}/attachments/${attachmentId}`, token), mediaType),
};

export const staffSupportApi = {
  queue: (filters: QueueFilters, limit: number, offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.eventId !== undefined) params.set("event_id", String(filters.eventId));
    if (filters.audience) params.set("audience", filters.audience);
    if (filters.escalated !== undefined) params.set("escalated", String(filters.escalated));
    if (filters.query?.trim()) params.set("q", filters.query.trim());
    return api.get<StaffCaseSummary[]>(`/staff/support/cases?${params}`, { signal });
  },
  case: (number: string, signal?: AbortSignal) => api.get<StaffCase>(staffPath(number), { signal }),
  reply: (number: string, body: string, internal: boolean) =>
    api.post<StaffCase>(`${staffPath(number)}/messages`, { body, is_internal_note: internal }),
  update: (number: string, input: StaffCaseUpdate) => api.patch<StaffCase>(staffPath(number), input),
  escalate: (number: string, reason: string) => api.post<StaffCase>(`${staffPath(number)}/escalate`, { reason: reason.trim() }),
  attach: (number: string, upload: AttachmentUpload) =>
    api.post<CaseAttachment>(`${staffPath(number)}/attachments`, attachmentBody(upload)),
  attachmentFile: (number: string, attachmentId: number, mediaType: string) =>
    api.file(`${staffPath(number)}/attachments/${attachmentId}`, mediaType),
};
