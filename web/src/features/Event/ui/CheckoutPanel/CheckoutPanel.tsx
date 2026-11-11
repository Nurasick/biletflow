import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { Minus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../../../hooks/useAuth";
import { useLocale } from "../../../../i18n/useLocale";
import { ApiError } from "../../../../shared/api/auth";
import { campaignsApi } from "../../../../shared/api/campaigns";
import type { PromoSource } from "../../../../shared/api/campaigns";
import { ordersApi } from "../../../../shared/api/events";
import type { EventDetail, PublicTicketType } from "../../../../shared/api/events";
import { formatMinor } from "../../../../shared/lib/formatPrice";
import { useAuthErrorMessage } from "../../../../shared/lib/useAuthErrorMessage";

// The backend's per-request bound (schemas/order.py MAX_TICKETS_PER_ORDER).
// Each type's own max_per_order applies on top (audit #19: one policy).
export const MAX_TICKETS_PER_ORDER = 20;

type Props = { event: EventDetail; ticketTypes: PublicTicketType[]; loading: boolean };

const limitFor = (type: PublicTicketType) => Math.max(0, Math.min(type.available, type.max_per_order ?? MAX_TICKETS_PER_ORDER));

export const CheckoutPanel = ({ event, ticketTypes, loading }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const errorMessage = useAuthErrorMessage();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [contact, setContact] = useState<{ name?: string; email?: string }>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const submitting = useRef(false);
  const contactName = contact.name ?? (me.data ? `${me.data.first_name} ${me.data.last_name}` : "");
  const contactEmail = contact.email ?? me.data?.email ?? "";

  const onSale = event.status === "published" && event.phase !== "completed";
  const selected = ticketTypes.filter((type) => quantities[type.id] > 0);
  const basket = selected.map((type) => ({ ticket_type_id: type.id, quantity: quantities[type.id] }));
  const total = basket.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = selected.reduce((sum, type) => sum + type.price_minor * quantities[type.id], 0);
  const purchasable = (type: PublicTicketType) => onSale && limitFor(type) > 0 && (type.price_minor === 0 || event.paid_sales_active);
  const selectionUnavailable = selected.some((type) => !purchasable(type) || quantities[type.id] > limitFor(type));

  const change = (type: PublicTicketType, delta: number) => setQuantities((current) => {
    const next = Math.min(limitFor(type), Math.max(0, (current[type.id] ?? 0) + delta));
    const others = ticketTypes.reduce((sum, item) => item.id === type.id ? sum : sum + (current[item.id] ?? 0), 0);
    if (others + next > MAX_TICKETS_PER_ORDER) return current;
    return { ...current, [type.id]: next };
  });

  const campaignToken = params.get("c");
  const promo: PromoSource | null = appliedCode ? { kind: "code", value: appliedCode }
    : campaignToken ? { kind: "token", value: campaignToken } : null;
  const quote = useQuery({
    queryKey: ["events", "promo", event.slug, promo, basket, subtotal],
    queryFn: promo && onSale ? ({ signal }) => campaignsApi.quote(event.slug, promo, basket, signal) : skipToken,
    retry: false,
  });
  const quoted = onSale && promo && quote.isSuccess && !quote.isFetching ? quote.data : undefined;
  const totalMinor = quoted?.total_minor ?? subtotal;
  const removeCampaignToken = () => {
    if (!campaignToken) return;
    const next = new URLSearchParams(params);
    next.delete("c");
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const buy = useMutation({
    mutationFn: () => ordersApi.checkout(event.slug, {
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      items: basket.map(({ ticket_type_id, quantity }) => ({
        ticket_type_id,
        attendees: Array.from({ length: quantity }, (_, i) => ({
          full_name: (names[`${ticket_type_id}-${i}`] ?? "").trim() || contactName.trim(),
        })),
      })),
      ...(promo?.kind === "code" && { promo_code: promo.value }),
      ...(promo?.kind === "token" && { campaign_token: promo.value }),
    }),
    onSuccess: (order) => navigate(`/orders/${encodeURIComponent(order.order_number)}?token=${encodeURIComponent(order.access_token)}`),
    onError: (error) => {
      if (promo && error instanceof ApiError && error.status === 409) void quote.refetch();
    },
    onSettled: () => { submitting.current = false; },
  });

  const canSubmit = onSale && !selectionUnavailable && total > 0 && Boolean(contactName.trim())
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()) && (!promo || Boolean(quoted)) && !buy.isPending;

  return (
    <aside aria-labelledby="buy" className="w-full shrink-0 self-start rounded-2xl border border-[#D0D5DD] bg-white p-5 lg:sticky lg:top-6 lg:w-[360px]">
      <h2 id="buy" className="text-[15px] font-semibold">{t("booking.selectTickets")}</h2>
      {loading && <p className="mt-4 text-sm text-[#667085]">{t("eventWorkflow.loading")}</p>}
      {!loading && ticketTypes.length === 0 && <p className="mt-4 text-sm text-[#667085]">{t("eventWorkflow.noTickets")}</p>}
      <ul className="mt-4 space-y-3">
        {ticketTypes.map((type) => {
          const count = quantities[type.id] ?? 0;
          const open = purchasable(type);
          return <li key={type.id} className="rounded-xl border border-[#EAECF0] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{type.name}</p>
                <p className="text-xs text-[#667085]">
                  {type.price_minor === 0 ? t("eventWorkflow.free") : formatMinor(type.price_minor, locale)}
                  {" · "}{type.available > 0 ? t("eventWorkflow.available", { count: type.available }) : t("booking.soldOut")}
                </p>
                {type.price_minor > 0 && !event.paid_sales_active && <p className="mt-1 text-xs text-[#A93216]">{t("checkout.paidInactive")}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label={t("booking.removeTicket", { name: type.name })} disabled={!count || buy.isPending}
                  onClick={() => change(type, -1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#D0D5DD] disabled:opacity-40">
                  <Minus size={14} aria-hidden="true" /></button>
                <span aria-live="polite" className="w-5 text-center text-sm font-semibold">{count}</span>
                <button type="button" aria-label={t("booking.addTicket", { name: type.name })}
                  disabled={buy.isPending || !open || count >= limitFor(type) || total >= MAX_TICKETS_PER_ORDER}
                  onClick={() => change(type, 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#D0D5DD] disabled:opacity-40">
                  <Plus size={14} aria-hidden="true" /></button>
              </div>
            </div>
            {Array.from({ length: count }, (_, i) => <Input key={i} size="small" className="mt-2" maxLength={200} disabled={buy.isPending}
              aria-label={t("checkout.attendeeName", { number: i + 1 })} placeholder={t("checkout.attendeeName", { number: i + 1 })}
              value={names[`${type.id}-${i}`] ?? ""} onChange={(e) => setNames({ ...names, [`${type.id}-${i}`]: e.target.value })} />)}
          </li>;
        })}
      </ul>
      {total > 0 && <div className="mt-4 space-y-2">
        <Input aria-label={t("checkout.contactName")} placeholder={t("checkout.contactName")} maxLength={200} disabled={buy.isPending}
          value={contactName} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
        <Input type="email" aria-label={t("common.email")} placeholder={t("common.emailPlaceholder")} disabled={buy.isPending}
          value={contactEmail} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
      </div>}
      {onSale && (promo || ticketTypes.some((type) => type.price_minor > 0)) && <div className="mt-4 space-y-2">
        <form onSubmit={(e) => {
          e.preventDefault();
          const code = codeInput.trim();
          if (!code || buy.isPending) return;
          buy.reset();
          removeCampaignToken();
          if (appliedCode === code) void quote.refetch();
          else setAppliedCode(code);
        }}>
          <label htmlFor="promo-code" className="text-sm font-semibold">{t("promo.code")}</label>
          <div className="mt-1 flex gap-2">
            <Input id="promo-code" autoComplete="off" maxLength={64} value={codeInput} disabled={buy.isPending}
              onChange={(e) => setCodeInput(e.target.value)} />
            <Button htmlType="submit" disabled={!codeInput.trim() || buy.isPending} loading={quote.isFetching}>
              {t("promo.apply")}
            </Button>
          </div>
        </form>
        {promo && <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" className="min-w-0 break-words text-xs text-[#475467]">
            {quote.isFetching ? t("promo.checking") : quoted && t("promo.applied", { code: quoted.code })}
          </div>
          <Button size="small" disabled={buy.isPending} onClick={() => {
            setCodeInput("");
            setAppliedCode(null);
            removeCampaignToken();
            buy.reset();
          }}>{t("promo.remove")}</Button>
        </div>}
        {promo && quote.isError && <Alert role="alert" type="warning" showIcon
          title={errorMessage(quote.error, t("promo.quoteError"))}
          action={!(quote.error instanceof ApiError && quote.error.status === 409) &&
            <Button size="small" onClick={() => void quote.refetch()}>{t("common.retry")}</Button>} />}
      </div>}
      <dl className="mt-4 space-y-2 border-t border-[#EAECF0] pt-4 text-sm">
        {quoted && quoted.discount_minor > 0 && <>
          <div className="flex justify-between gap-3 text-[#667085]">
            <dt>{t("booking.subtotal")}</dt><dd>{formatMinor(quoted.subtotal_minor, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-[#027A48]">
            <dt>{t("promo.discount")}</dt><dd>{formatMinor(-quoted.discount_minor, locale)}</dd>
          </div>
        </>}
        <div className="flex items-center justify-between gap-3">
          <dt>{t("checkout.total")}</dt><dd className="text-lg font-bold">{formatMinor(totalMinor, locale)}</dd>
        </div>
      </dl>
      {total >= MAX_TICKETS_PER_ORDER && <p className="mt-2 text-xs text-[#667085]">{t("booking.orderLimit", { limit: MAX_TICKETS_PER_ORDER })}</p>}
      {selectionUnavailable && <p role="alert" className="mt-2 text-xs text-[#A93216]">{t("checkout.selectionUnavailable")}</p>}
      <Button type="primary" block className="mt-4" disabled={!canSubmit} loading={buy.isPending} onClick={() => {
        if (!canSubmit || submitting.current) return;
        submitting.current = true;
        buy.mutate();
      }}>
        {totalMinor > 0 ? t("checkout.continueToPayment") : t("checkout.register")}
      </Button>
      {buy.isError && buy.error.message !== quote.error?.message && <Alert role="alert" type="error" showIcon className="mt-3"
        title={errorMessage(buy.error, t("eventWorkflow.networkError"))} />}
    </aside>
  );
};
