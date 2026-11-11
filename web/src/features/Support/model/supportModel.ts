import { caseCategories, caseStatuses } from "../../../shared/api/support";
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

export const queueFilters = (params: URLSearchParams): QueueFilters => ({
  status: caseStatuses.find((status) => status === params.get("status")),
  category: caseCategories.find((category) => category === params.get("category")),
  eventId: positiveId(params.get("event_id")),
});
