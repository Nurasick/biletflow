import { api, rawRequest } from "./auth";

export type EventAccessInput = { access_code: string } | { invite_token: string };

export const eventAccessHeaders = (accessToken?: string | null): Record<string, string> =>
  accessToken ? { "X-Event-Access-Token": accessToken } : {};

const eventPath = (slug: string) => `/events/${encodeURIComponent(slug)}`;

export const eventAccessApi = {
  unlock: (slug: string, credentials: EventAccessInput) =>
    rawRequest<{ event_slug: string; access_token: string }>(`${eventPath(slug)}/unlock`, api.json("POST", credentials)),
};

const accessKey = (slug: string) => `biletflow.event-access.${slug}`;

export const storedEventAccess = (slug: string) => {
  try {
    return sessionStorage.getItem(accessKey(slug));
  } catch {
    return null;
  }
};

export const saveEventAccess = (slug: string, token: string) => {
  try {
    sessionStorage.setItem(accessKey(slug), token);
  } catch {
    // Access remains available for the current page when storage is disabled.
  }
};
