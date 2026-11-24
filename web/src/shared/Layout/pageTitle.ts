import type { ParseKeys } from "i18next";

export const APP_NAME = "BiletFlow";

type TitleKey = ParseKeys;

/** Route patterns in priority order; the first match names the page (WCAG 2.4.2). */
const routeTitles: Array<[RegExp, TitleKey]> = [
  [/^\/$/, "catalogue.title"],
  [/^\/events\/[^/]+$/, "pageTitle.event"],
  [/^\/orders\/[^/]+$/, "orders.title"],
  [/^\/login$/, "auth.signInTitle"],
  [/^\/signup$/, "auth.signupTitle"],
  [/^\/forgot-password$/, "pageTitle.forgotPassword"],
  [/^\/reset-password$/, "auth.resetPassword"],
  [/^\/verify-email$/, "verify.title"],
  [/^\/account$/, "account.title"],
  [/^\/notifications$/, "notifications.title"],
  [/^\/support$/, "common.help"],
  [/^\/support\/[^/]+$/, "pageTitle.supportCase"],
  [/^\/staff\/events$/, "ops.assignedEvents"],
  [/^\/staff\/events\/[^/]+$/, "nav.checkIn"],
  [/^\/staff\/support$/, "support.queue"],
  [/^\/staff\/support\/[^/]+$/, "pageTitle.supportCase"],
  [/^\/admin$/, "adminOverview.title"],
  [/^\/admin\/events$/, "ops.adminEvents"],
  [/^\/admin\/events\/[^/]+$/, "pageTitle.adminEvent"],
  [/^\/admin\/users$/, "adminUsers.title"],
  [/^\/admin\/reports$/, "eventReport.queue"],
  [/^\/admin\/transactions$/, "adminFinance.title"],
  [/^\/admin\/sales$/, "adminSales.title"],
  [/^\/admin\/disputes$/, "adminDisputes.title"],
  [/^\/admin\/settings$/, "adminSettings.title"],
  [/^\/organizer\/events$/, "eventWorkflow.myEvents"],
  [/^\/organizer\/events\/new$/, "pageTitle.newEvent"],
  [/^\/organizer\/events\/[^/]+\/edit$/, "organizerEvent.editTitle"],
  [/^\/organizer\/events\/[^/]+\/preview$/, "eventWorkflow.preview"],
  [/^\/organizer\/events\/[^/]+\/analytics$/, "analytics.title"],
  [/^\/organizer\/profile$/, "organizer.profile"],
];

/** The translation key naming the page at `pathname`, or null for unknown routes. */
export const pageTitleKey = (pathname: string): TitleKey | null => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return routeTitles.find(([pattern]) => pattern.test(path))?.[1] ?? null;
};

/** "Page · BiletFlow", or just the app name when the page has no title. */
export const documentTitle = (page?: string | null) => page?.trim() ? `${page.trim()} · ${APP_NAME}` : APP_NAME;
