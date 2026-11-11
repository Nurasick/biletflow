import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { Bell, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EventCalendarButton } from "../features/Event/ui/EventCalendarButton";
import { notificationDestination, notificationTitleKey } from "../features/Notifications/model/notificationModel";
import { OperationsError, OperationsLoading, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { notificationKey, notificationsApi } from "../shared/api/notifications";
import type { Notification } from "../shared/api/notifications";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";

export const NotificationsPage = () => {
  const { me } = useAuth();
  return me.data && <NotificationInbox key={me.data.id} userId={me.data.id} />;
};

const NotificationInbox = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const client = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const queryKey = notificationKey(userId);
  const feed = useQuery({ queryKey, queryFn: ({ signal }) => notificationsApi.feed(signal), retry: false });
  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const unread = feed.data?.unread ?? 0;

  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-7 sm:py-10">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <Bell size={24} className="text-[#D9431F]" aria-hidden="true" />{t("notifications.title")}
        </h1>
        {feed.isSuccess && <p role="status" className="mt-2 text-sm text-[#667085]">
          {t("notifications.unreadCount", { unread: new Intl.NumberFormat(locale).format(unread) })}
        </p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <RefreshButton refresh={() => void feed.refetch()} fetching={feed.isFetching} />
        <Button icon={<Check size={16} aria-hidden="true" />} loading={markRead.isPending} disabled={!unread || feed.isError}
          onClick={() => markRead.mutate()}>{t("notifications.markRead")}</Button>
      </div>
    </div>
    <div className="mt-6 space-y-4">
      {markRead.isError && <Alert role="alert" type="error" showIcon
        title={errorMessage(markRead.error, t("notifications.markError"))} />}
      {feed.isPending ? <OperationsLoading /> : feed.isError
        ? <OperationsError error={feed.error} retry={() => void feed.refetch()} /> : feed.data.items.length === 0
        ? <p className="rounded-xl border border-[#D0D5DD] p-6 text-sm text-[#667085]">{t("notifications.empty")}</p>
        : <ul className="space-y-3">
          {feed.data.items.map((item) => <NotificationItem key={item.id} item={item} date={date} />)}
        </ul>}
    </div>
  </main>;
};

const NotificationItem = ({ item, date }: { item: Notification; date: Intl.DateTimeFormat }) => {
  const { t } = useTranslation();
  const title = notificationTitleKey(item.template_key);
  const destination = notificationDestination(item.payload.link);
  const fields = title === "notifications.generic" ? []
    : ["event_title", "order_number", "case_number", "amount", "changes", "reason", "subject", "excerpt"];
  const details = fields.map((field) => item.payload[field])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const status = item.payload.status;
  if (item.template_key === "payout.status" && (status === "active" || status === "suspended" || status === "pending")) {
    details.push(t(`activation.status.${status}`));
  }
  if (item.template_key === "support.status" && typeof status === "string" && status.trim()) details.push(status);

  return <li className={`rounded-xl border p-4 sm:p-5 ${item.read_at ? "border-[#D0D5DD] bg-white" : "border-[#FFD1C5] bg-[#FFF8F5]"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="text-base font-semibold">{t(title)}</h2>
      <div className="flex items-center gap-2 text-xs text-[#667085]">
        {!item.read_at && <span className="rounded-full bg-[#FFEEE8] px-2 py-1 font-semibold text-[#A93216]">{t("notifications.unread")}</span>}
        <time dateTime={item.created_at}>{date.format(new Date(item.created_at))}</time>
      </div>
    </div>
    {details.length > 0 && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-[#475467]">{details.join(" · ")}</p>}
    {destination && <div className="mt-3">
      {destination.kind === "calendar" ? <EventCalendarButton slug={destination.slug} cancelled />
        : <Link to={destination.href} className="text-sm font-semibold text-[#A93216] hover:underline">{t(destination.label)}</Link>}
    </div>}
  </li>;
};
