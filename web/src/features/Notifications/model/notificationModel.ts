export const NOTIFICATION_POLL_INTERVAL = 30_000;

const titleKeys = {
  "order.confirmed": "notifications.orderConfirmed",
  "payment.failed": "notifications.paymentFailed",
  "order.cancelled": "notifications.orderCancelled",
  "refund.completed": "notifications.refundCompleted",
  "event.updated": "notifications.eventUpdated",
  "event.cancelled": "notifications.eventCancelled",
  "payout.status": "notifications.payoutStatus",
  "support.message": "notifications.supportMessage",
  "support.assigned": "notifications.supportAssigned",
  "support.status": "notifications.supportStatus",
} as const;

export const notificationTitleKey = (key: string) =>
  Object.hasOwn(titleKeys, key) ? titleKeys[key as keyof typeof titleKeys] : "notifications.generic";

type Destination =
  | { kind: "calendar"; slug: string }
  | { kind: "page"; href: string; label: "notifications.viewOrder" | "notifications.viewEvent" | "notifications.viewCase" };

// The API sends absolute links for email. Resolve known destinations inside
// this app, where signed-in users already have access to their orders and cases.
export const notificationDestination = (link: unknown): Destination | null => {
  if (typeof link !== "string") return null;
  let url: URL;
  try {
    url = new URL(link, "https://biletflow.invalid");
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const path = url.pathname;
  const calendar = /\/events\/([a-z0-9-]{3,200})\/calendar\.ics$/.exec(path);
  if (calendar) return { kind: "calendar", slug: calendar[1] };
  if (/^\/orders\/[a-z0-9-]{1,32}$/i.test(path)) {
    return { kind: "page", href: path, label: "notifications.viewOrder" };
  }
  if (/^\/(?:staff\/)?support\/[a-z0-9-]{1,32}$/i.test(path)) {
    return { kind: "page", href: path, label: "notifications.viewCase" };
  }
  if (/^\/events\/[a-z0-9-]{3,200}$/.test(path) || /^\/organizer\/events\/[1-9]\d*\/preview$/.test(path)) {
    return { kind: "page", href: path, label: "notifications.viewEvent" };
  }
  return null;
};
