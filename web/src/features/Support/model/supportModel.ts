import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, caseAudiences, caseCategories, caseStatuses } from "../../../shared/api/support";
import type { CaseStatus, QueueFilters, StaffCaseStatus } from "../../../shared/api/support";

export const SUPPORT_POLL_INTERVAL = 30_000;
export const MESSAGE_MAX_LENGTH = 5_000;
export const CASE_PAGE_SIZE = 20;

export const supportKeys = {
  mine: (userId: number) => ["support", "mine", userId] as const,
  requester: (number: string, userId: number | null, token: string | null) =>
    ["support", "requester", number, userId, token] as const,
  staff: (number: string, userId: number) => ["support", "staff", number, userId] as const,
  queue: (userId: number) => ["support", "queue", userId] as const,
};

export const staffTransitions: Record<CaseStatus, readonly StaffCaseStatus[]> = {
  open: ["in_progress"],
  in_progress: ["waiting_for_customer", "resolved"],
  waiting_for_customer: ["resolved"],
  resolved: [],
};

export const positiveId = (value: string | null) => {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
};

export const QUEUE_QUERY_MAX = 100;
export const ESCALATION_REASON_MAX = 1_000;

export const queueFilters = (params: URLSearchParams): QueueFilters => {
  const query = (params.get("q") ?? "").trim().slice(0, QUEUE_QUERY_MAX);
  return {
    status: caseStatuses.find((status) => status === params.get("status")),
    category: caseCategories.find((category) => category === params.get("category")),
    eventId: positiveId(params.get("event_id")),
    audience: caseAudiences.find((audience) => audience === params.get("audience")),
    ...(params.get("escalated") === "true" && { escalated: true }),
    ...(query && { query }),
  };
};

/** The queue filters back as URL parameters (the inverse of `queueFilters`). */
export const queueSearch = (filters: QueueFilters, page = 0) => {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.category) search.set("category", filters.category);
  if (filters.eventId) search.set("event_id", String(filters.eventId));
  if (filters.audience) search.set("audience", filters.audience);
  if (filters.escalated) search.set("escalated", "true");
  if (filters.query) search.set("q", filters.query);
  if (page > 0) search.set("page", String(page + 1));
  return search;
};

export type AttachmentProblem = "support.attachmentType" | "support.attachmentSize";

/** Why the backend would refuse this file, checked before reading it. */
export const attachmentProblem = (file: { type: string; size: number }): AttachmentProblem | null => {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return "support.attachmentType";
  if (file.size === 0 || file.size > ATTACHMENT_MAX_BYTES) return "support.attachmentSize";
  return null;
};
