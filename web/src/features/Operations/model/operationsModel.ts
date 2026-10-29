import type { AdminActivationAction, AdminEventAction } from "../../../shared/api/admin";
import type { ScannedTicket } from "../../../shared/api/staff";

export const operationsKeys = {
  staffEvents: (userId?: number) => ["operations", userId, "staff-events"] as const,
  attendance: (userId: number | undefined, eventId: number) => ["operations", userId, "attendance", eventId] as const,
  ticketSearches: (userId: number | undefined, eventId: number) => ["operations", userId, "ticket-search", eventId] as const,
  ticketSearch: (userId: number | undefined, eventId: number, query: string) => ["operations", userId, "ticket-search", eventId, query] as const,
  adminLists: (userId?: number) => ["operations", userId, "admin-events"] as const,
  adminList: (userId: number | undefined, query: string, page: number) => ["operations", userId, "admin-events", query, page] as const,
  adminEvent: (userId: number | undefined, eventId: number) => ["operations", userId, "admin-event", eventId] as const,
  activation: (userId: number | undefined, eventId: number) => ["operations", userId, "activation", eventId] as const,
  timelines: (userId: number | undefined, eventId: number) => ["operations", userId, "timeline", eventId] as const,
  timeline: (userId: number | undefined, eventId: number, page: number) => ["operations", userId, "timeline", eventId, page] as const,
};

export const ticketAction = (ticket: ScannedTicket): "admit" | "reverse" | null => {
  if (ticket.status === "valid") return "admit";
  if (ticket.status === "checked_in") return "reverse";
  return null;
};

export const eventModerationActions = (status: string): AdminEventAction[] => {
  if (status === "published") return ["suspend", "cancel"];
  if (status === "suspended") return ["unsuspend", "cancel"];
  if (status === "draft") return ["cancel"];
  return [];
};

export const activationModerationAction = (status: string): AdminActivationAction | null => {
  if (status === "active") return "suspend";
  if (status === "suspended") return "reinstate";
  return null;
};

export const validEventId = (value?: string) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
