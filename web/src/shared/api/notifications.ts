import { api } from "./auth";

export type Notification = {
  id: number;
  template_key: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type NotificationFeed = {
  unread: number;
  items: Notification[];
};

export const notificationKey = (userId: number) => ["notifications", userId] as const;

export const notificationsApi = {
  feed: (signal?: AbortSignal) => api.get<NotificationFeed>("/users/me/notifications", { signal }),
  markRead: () => api.post<null>("/users/me/notifications/read"),
};
