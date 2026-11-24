import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { notificationKey, notificationsApi } from "../../../shared/api/notifications";
import { NOTIFICATION_POLL_INTERVAL } from "../model/notificationModel";

export const NotificationLink = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const feed = useQuery({
    queryKey: notificationKey(userId),
    queryFn: ({ signal }) => notificationsApi.feed(signal),
    refetchInterval: NOTIFICATION_POLL_INTERVAL,
    staleTime: 15_000,
    retry: false,
  });
  const unread = feed.isError ? 0 : feed.data?.unread ?? 0;
  const count = new Intl.NumberFormat(locale).format(unread);

  return <Link to="/notifications"
    className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted-strong hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
    <Bell size={18} aria-hidden="true" />
    <span className="sr-only">{unread ? t("notifications.badge", { unread: count }) : t("notifications.title")}</span>
    {unread > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
      {unread > 99 ? "99+" : count}
    </span>}
  </Link>;
};
