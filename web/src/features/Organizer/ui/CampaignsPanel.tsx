import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Spin, Typography } from "antd";
import { Plus, Tag } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { campaignsApi } from "../../../shared/api/campaigns";
import type { Campaign } from "../../../shared/api/campaigns";
import { ticketTypesApi } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";
import { organizerEventKeys } from "../model/useEventLifecycle";
import { CampaignForm } from "./CampaignForm";

type Props = { eventId: number; userId: number; timeZone: string };

export const CampaignsPanel = ({ eventId, userId, timeZone }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const errorMessage = useAuthErrorMessage();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const queryKey = ["organizer", "campaigns", userId, eventId] as const;
  const campaigns = useQuery({
    queryKey, queryFn: ({ signal }) => campaignsApi.list(eventId, signal), retry: false,
  });
  const types = useQuery({
    queryKey: organizerEventKeys.ticketTypes(eventId), queryFn: () => ticketTypesApi.list(eventId),
  });

  const open = (campaign: Campaign | "new", button: HTMLElement) => {
    opener.current = button;
    setEditing(campaign);
  };
  const close = () => {
    setEditing(null);
    const button = opener.current;
    requestAnimationFrame(() => button?.focus());
  };
  const saved = (campaign: Campaign) => {
    void client.cancelQueries({ queryKey });
    client.setQueryData<Campaign[]>(queryKey, (current = []) => current.some((item) => item.id === campaign.id)
      ? current.map((item) => item.id === campaign.id ? campaign : item) : [campaign, ...current]);
    void client.invalidateQueries({ queryKey });
    void client.invalidateQueries({ queryKey: ["organizer", "timeline", userId, eventId] });
    close();
  };

  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });

  return <section id="event-campaigns" aria-labelledby="campaigns-title" className="scroll-mt-6 rounded-xl border border-[#D0D5DD] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="campaigns-title" className="flex items-center gap-2 font-semibold">
        <Tag size={18} aria-hidden="true" />{t("campaigns.title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button size="small" loading={campaigns.isFetching} onClick={() => void campaigns.refetch()}>{t("reports.refresh")}</Button>
        <Button size="small" type="primary" icon={<Plus size={15} aria-hidden="true" />} onClick={(e) => open("new", e.currentTarget)}>
          {t("campaigns.create")}
        </Button>
      </div>
    </div>
    {campaigns.isPending && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[#667085]">
      <Spin size="small" />{t("campaigns.loading")}
    </p>}
    {campaigns.isError && <Alert role="alert" type="error" showIcon className="mt-4"
      title={errorMessage(campaigns.error, t("campaigns.loadError"))} />}
    {campaigns.data?.length === 0 && <p className="mt-4 text-sm text-[#667085]">{t("campaigns.empty")}</p>}
    {campaigns.data && campaigns.data.length > 0 && <ul className="mt-4 space-y-3">
      {campaigns.data.map((campaign) => {
        const { stats } = campaign;
        const discount = campaign.discount_type === "percent"
          ? new Intl.NumberFormat(locale, { style: "percent" }).format(campaign.discount_value / 100)
          : formatMinor(campaign.discount_value, locale);
        const metrics = [
          { label: t("campaigns.redemptions"), value: campaign.max_redemptions === null
            ? number.format(stats.redemptions)
            : t("campaigns.usedLimit", { used: number.format(stats.redemptions), limit: number.format(campaign.max_redemptions) }) },
          { label: t("campaigns.orders"), value: number.format(stats.orders) },
          { label: t("campaigns.tickets"), value: number.format(stats.tickets_sold) },
          { label: t("campaigns.gross"), value: formatMinor(stats.gross_minor, locale) },
          { label: t("promo.discount"), value: formatMinor(stats.discount_minor, locale) },
          { label: t("campaigns.refunds"), value: formatMinor(stats.refunds_minor, locale) },
          { label: t("campaigns.net"), value: formatMinor(stats.net_minor, locale) },
        ];
        return <li key={campaign.id} className="rounded-xl border border-[#EAECF0] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-sm font-semibold">{campaign.name}</h3>
              <p className="mt-1 break-all text-xs text-[#475467]">
                <code className="font-semibold">{campaign.code}</code> · {discount}
              </p>
              {(campaign.starts_at || campaign.ends_at) && <p className="mt-1 text-xs text-[#667085]">
                {campaign.starts_at && t("campaigns.starts", { date: date.format(new Date(campaign.starts_at)) })}
                {campaign.starts_at && campaign.ends_at && " · "}
                {campaign.ends_at && t("eventWorkflow.ends", { date: date.format(new Date(campaign.ends_at)) })}
              </p>}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${campaign.is_active
              ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#F2F4F7] text-[#475467]"}`}>
              {t(campaign.is_active ? "campaigns.enabled" : "campaigns.disabled")}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-[#F5F5F0] p-3 text-xs sm:grid-cols-4">
            {metrics.map(({ label, value }) => <div key={label}>
              <dt className="text-[#667085]">{label}</dt><dd className="mt-0.5 font-semibold">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-4 text-xs font-semibold">{t("campaigns.link")}</p>
          <Typography.Paragraph className="mt-1 text-xs [overflow-wrap:anywhere]"
            copyable={{ text: campaign.link, tooltips: [t("campaigns.copyLink"), t("campaigns.copied")] }}>
            {campaign.link}
          </Typography.Paragraph>
          <div className="flex flex-wrap items-start gap-2">
            <FileDownloadButton label={t("campaigns.downloadQr")} filename={`promo-${campaign.code}.svg`}
              getFile={() => campaignsApi.qr(eventId, campaign.id)} />
            <Button size="small" onClick={(e) => open(campaign, e.currentTarget)}>{t("campaigns.edit")}</Button>
          </div>
        </li>;
      })}
    </ul>}
    {editing && <CampaignForm campaign={editing === "new" ? null : editing} eventId={eventId}
      timeZone={timeZone} ticketTypes={types.data ?? []} loadingTypes={types.isFetching && !types.data}
      retryTypes={types.isError && !types.data ? () => void types.refetch() : undefined} onClose={close} onSaved={saved} />}
  </section>;
};
