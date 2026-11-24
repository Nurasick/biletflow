import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { Minus, Plus, Ticket } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../../../hooks/useAuth";
import { useLocale } from "../../../../i18n/useLocale";
import { ApiError } from "../../../../shared/api/auth";
import { campaignsApi } from "../../../../shared/api/campaigns";
import type { PromoSource } from "../../../../shared/api/campaigns";
import { eventsApi, ordersApi } from "../../../../shared/api/events";
import type { EventDetail, EventSeat, PublicTicketType } from "../../../../shared/api/events";
import { trackCheckoutStart } from "../../../../shared/lib/analytics";
import { formatMinor } from "../../../../shared/lib/formatPrice";
import { useAuthErrorMessage } from "../../../../shared/lib/useAuthErrorMessage";
import { ticketSaleStatus, ticketSaleWindow } from "../../model/ticketSales";
import { SeatMap } from "../SeatMap/SeatMap";

// The backend's per-request bound (schemas/order.py MAX_TICKETS_PER_ORDER).
// Each type's own max_per_order applies on top (audit #19: one policy).
export const MAX_TICKETS_PER_ORDER = 20;
const MAX_TIMEOUT_MS = 2_147_483_647;
const inputStyles = "border-muted! hover:border-primary! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-primary! aria-invalid:border-red-700!";

type Props = {
  event: EventDetail;
  ticketTypes: PublicTicketType[];
  loading: boolean;
  accessToken?: string | null;
  accessRevision?: string | null;
};
type CheckoutTicket = PublicTicketType & { saleWindow: ReturnType<typeof ticketSaleWindow> };

const limitFor = (type: PublicTicketType) => Math.max(0, Math.min(type.available, type.max_per_order ?? MAX_TICKETS_PER_ORDER));

export const CheckoutPanel = ({ event, accessRevision, ...props }: Props) => (
  <CheckoutForm key={JSON.stringify([event.id, accessRevision])} event={event} accessRevision={accessRevision} {...props} />
);

const CheckoutForm = ({ event, ticketTypes, loading, accessToken, accessRevision }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const errorMessage = useAuthErrorMessage();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [pickedSeats, setPickedSeats] = useState<ReadonlyMap<number, EventSeat>>(() => new Map());
  const [contact, setContact] = useState<{ name?: string; email?: string }>({});
  const [contactValidated, setContactValidated] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const submitting = useRef(false);
  const trackedStart = useRef(false);
  const formId = useId();
  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const contactName = contact.name ?? (me.data ? `${me.data.first_name} ${me.data.last_name}` : "");
  const contactEmail = contact.email ?? me.data?.email ?? "";
  const missingName = !contactName.trim();
  const invalidEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const nameError = contactValidated && missingName;
  const emailError = contactValidated && invalidEmail;

  const tickets = useMemo(() => ticketTypes.map((type) => ({ ...type, saleWindow: ticketSaleWindow(event, type) })), [event, ticketTypes]);
  useEffect(() => {
    let next = Infinity;
    for (const { saleWindow: { opens, closes } } of tickets) {
      if (opens > now) next = Math.min(opens, next);
      if (closes > now) next = Math.min(closes, next);
    }
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(1, next - Date.now()), MAX_TIMEOUT_MS));
    return () => window.clearTimeout(timer);
  }, [now, tickets]);

  const onSale = event.status === "published" && event.phase !== "completed";
  const assigned = event.seating_mode === "assigned";
  const seatMap = useQuery({
    queryKey: ["events", "seats", event.slug, me.data?.id ?? null, accessRevision ?? null],
    queryFn: assigned && onSale ? ({ signal }) => eventsApi.seats(event.slug, accessToken, signal) : skipToken,
    refetchInterval: 15_000,
    retry: false,
  });
  const liveSeats = useMemo(() => new Map(seatMap.data?.sections.flatMap((section) =>
    section.rows.flatMap((row) => row.seats.map((seat) => [seat.event_seat_id, seat] as const))) ?? []), [seatMap.data]);
  const seatsByType = new Map<number, number[]>();
  for (const [id, seat] of pickedSeats) {
    if (seat.ticket_type_id === null) continue;
    const ids = seatsByType.get(seat.ticket_type_id) ?? [];
    ids.push(id);
    seatsByType.set(seat.ticket_type_id, ids);
  }
  const countFor = (id: number) => assigned ? seatsByType.get(id)?.length ?? 0 : quantities[id] ?? 0;
  const selected = tickets.filter((type) => countFor(type.id) > 0);
  const basket = selected.map((type) => ({ ticket_type_id: type.id, quantity: countFor(type.id) }));
  const total = basket.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = selected.reduce((sum, type) => sum + type.price_minor * countFor(type.id), 0);
  const purchasable = (type: CheckoutTicket, at = now) => onSale && ticketSaleStatus(type.saleWindow, at) === "open"
    && limitFor(type) > 0 && (type.price_minor === 0 || event.paid_sales_active);
  const seatUnavailable = [...pickedSeats].some(([id, original]) => {
    const live = liveSeats.get(id);
    return live?.status !== "available" || live.ticket_type_id !== original.ticket_type_id;
  });
  const selectionUnavailable = selected.some((type) => !purchasable(type) || countFor(type.id) > limitFor(type))
    || (assigned && pickedSeats.size > 0 && (seatMap.isError || seatUnavailable || pickedSeats.size !== total));

  const canSelectSeat = (seat: EventSeat) => {
    if (seat.status !== "available" || seatMap.isError || pickedSeats.size >= MAX_TICKETS_PER_ORDER) return false;
    const type = tickets.find(({ id }) => id === seat.ticket_type_id);
    return Boolean(type && purchasable(type) && countFor(type.id) < limitFor(type));
  };
  const toggleSeat = (seat: EventSeat) => {
    if (!pickedSeats.has(seat.event_seat_id) && !canSelectSeat(seat)) return;
    setPickedSeats((current) => {
      const next = new Map(current);
      if (!next.delete(seat.event_seat_id)) next.set(seat.event_seat_id, seat);
      return next;
    });
  };

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
    queryKey: ["events", "promo", event.slug, me.data?.id ?? null, accessRevision ?? null, promo, basket, subtotal],
    queryFn: promo && onSale ? ({ signal }) => campaignsApi.quote(event.slug, promo, basket, signal, accessToken) : skipToken,
    retry: false,
  });
  const quoted = onSale && promo && quote.isSuccess && !quote.isFetching ? quote.data : undefined;
  const totalMinor = quoted?.total_minor ?? subtotal;
  // The platform deducts this portion from the organizer's payout. It is included in totalMinor.
  const feeMinor = event.processing_fee_bps === undefined ? null : Math.floor((totalMinor * event.processing_fee_bps + 5_000) / 10_000);
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
        attendees: Array.from({ length: quantity }, (_, i) => {
          const seatId = seatsByType.get(ticket_type_id)?.[i];
          const nameKey = seatId === undefined ? `${ticket_type_id}-${i}` : `seat-${seatId}`;
          return {
            full_name: (names[nameKey] ?? "").trim() || contactName.trim(),
            ...(seatId !== undefined && { event_seat_id: seatId }),
          };
        }),
      })),
      ...(promo?.kind === "code" && { promo_code: promo.value }),
      ...(promo?.kind === "token" && { campaign_token: promo.value }),
    }, accessToken),
    onSuccess: (order) => navigate(`/orders/${encodeURIComponent(order.order_number)}?token=${encodeURIComponent(order.access_token)}`),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        if (promo) void quote.refetch();
        if (assigned) void seatMap.refetch();
      }
    },
    onSettled: () => { submitting.current = false; },
  });

  const canSubmit = onSale && !selectionUnavailable && total > 0 && (!promo || Boolean(quoted)) && !buy.isPending;
  const saleTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone });

  return (
    <aside id="ticket-booking" tabIndex={-1} aria-labelledby="buy" className="panel min-w-0 scroll-mt-6 p-5 sm:p-6 lg:sticky lg:top-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-wash text-primary"><Ticket size={20} aria-hidden="true" /></span>
        <h2 id="buy" className="text-xl font-extrabold tracking-[-0.035em]">{t("booking.selectTickets")}</h2>
      </div>
      {loading && <p role="status" className="mt-4 text-sm text-muted">{t("common.loading")}</p>}
      {!loading && ticketTypes.length === 0 && <p className="mt-4 text-sm text-muted">{t("eventWorkflow.noTickets")}</p>}
      {assigned && onSale && <>
        {seatMap.isPending && <p role="status" className="mt-4 text-sm text-muted">{t("booking.loadingSeats")}</p>}
        {seatMap.isError && <Alert className="mt-4" type="warning" showIcon title={t("booking.seatMapError")}
          action={<Button size="small" loading={seatMap.isFetching} onClick={() => void seatMap.refetch()}>{t("common.retry")}</Button>} />}
        {seatMap.data && <SeatMap map={seatMap.data} selected={pickedSeats} canSelect={canSelectSeat}
          onToggle={toggleSeat} disabled={buy.isPending} />}
        {pickedSeats.size > 0 && <ul className="mt-3 space-y-2">
          {[...pickedSeats.values()].map((seat, index) => {
            const key = `seat-${seat.event_seat_id}`;
            const nameId = `${formId}-${key}`;
            return <li key={key} className="rounded-lg border border-line-soft bg-paper p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold" id={`${nameId}-seat`}>{seat.seat_label}</p>
                <Button size="small" disabled={buy.isPending} onClick={() => toggleSeat(seat)}
                  aria-label={t("booking.removeSeat", { seat: seat.seat_label })}>{t("promo.remove")}</Button>
              </div>
              <label htmlFor={nameId} className="mt-2 block text-sm font-semibold">{t("checkout.attendeeName", { number: index + 1 })}</label>
              <Input id={nameId} className={`mt-1 ${inputStyles}`} maxLength={200} disabled={buy.isPending}
                aria-describedby={`${nameId}-seat`} value={names[key] ?? ""} onChange={(e) => setNames({ ...names, [key]: e.target.value })} />
            </li>;
          })}
        </ul>}
      </>}
      {!assigned && <ul className="mt-4 space-y-3">
        {tickets.map((type) => {
          const count = quantities[type.id] ?? 0;
          const open = purchasable(type);
          const addDisabled = buy.isPending || !open || count >= limitFor(type) || total >= MAX_TICKETS_PER_ORDER;
          const removeDisabled = !count || buy.isPending;
          const typeId = `${formId}-ticket-${type.id}`;
          const windowStatus = ticketSaleStatus(type.saleWindow, now);
          const saleMessage = windowStatus === "upcoming" ? t("ticketTypes.opensAt", { date: saleTime.format(type.saleWindow.opens) })
            : windowStatus === "closed" ? t("checkout.salesClosed")
              : windowStatus === "unavailable" ? t("checkout.salesUnavailable") : null;
          return <li key={type.id} className="rounded-xl border border-line-soft bg-paper p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p id={typeId} className="text-sm font-bold wrap-anywhere">{type.name}</p>
                {type.description && <p className="my-1 whitespace-pre-wrap break-words text-xs text-muted-strong">{type.description}</p>}
                <p className="text-xs text-muted">
                  {type.price_minor === 0 ? t("eventWorkflow.free") : formatMinor(type.price_minor, locale)}
                  {onSale && windowStatus === "open" && <>
                    {" · "}{type.available > 0 ? t("eventWorkflow.available", { count: type.available }) : t("booking.soldOut")}
                  </>}
                </p>
                {onSale && saleMessage && <p className="mt-1 text-xs text-primary-hover">{saleMessage}</p>}
                {type.price_minor > 0 && !event.paid_sales_active && <p className="mt-1 text-xs text-primary-hover">{t("checkout.paidInactive")}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label={t("booking.removeTicket", { name: type.name })} aria-disabled={removeDisabled}
                  tabIndex={removeDisabled ? -1 : undefined} onClick={() => { if (!removeDisabled) change(type, -1); }}
                  className="grid size-10 place-items-center rounded-lg border border-line bg-white text-primary hover:border-primary aria-disabled:cursor-default aria-disabled:opacity-40">
                  <Minus size={14} aria-hidden="true" /></button>
                <span role="status" aria-labelledby={typeId} className="w-5 text-center text-sm font-semibold">{count}</span>
                <button type="button" aria-label={t("booking.addTicket", { name: type.name })}
                  aria-disabled={addDisabled} tabIndex={addDisabled && !count ? -1 : undefined}
                  onClick={() => { if (!addDisabled) change(type, 1); }}
                  className="grid size-10 place-items-center rounded-lg border border-line bg-white text-primary hover:border-primary aria-disabled:cursor-default aria-disabled:opacity-40">
                  <Plus size={14} aria-hidden="true" /></button>
              </div>
            </div>
            {Array.from({ length: count }, (_, i) => <label key={i} className="mt-2 block text-sm font-semibold">
              {t("checkout.attendeeName", { number: i + 1 })}
              <Input className={`mt-1 ${inputStyles}`} maxLength={200} disabled={buy.isPending} aria-describedby={typeId}
                value={names[`${type.id}-${i}`] ?? ""} onChange={(e) => setNames({ ...names, [`${type.id}-${i}`]: e.target.value })} />
            </label>)}
          </li>;
        })}
      </ul>}
      <form id={formId} noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit || submitting.current) return;
        if (missingName || invalidEmail) {
          setContactValidated(true);
          window.requestAnimationFrame(() => document.getElementById(missingName ? nameId : emailId)?.focus());
          return;
        }
        const currentTime = Date.now();
        if (selected.some((type) => !purchasable(type, currentTime))) { setNow(currentTime); return; }
        submitting.current = true;
        if (!trackedStart.current) {
          trackedStart.current = true;
          void trackCheckoutStart(event.id, campaignToken);
        }
        buy.mutate();
      }}>
        {total > 0 && <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={nameId} className="block text-sm font-semibold">{t("checkout.contactName")}</label>
            <Input id={nameId} className={`mt-1.5 ${inputStyles}`} autoComplete="name" maxLength={200} required disabled={buy.isPending}
              status={nameError ? "error" : undefined} aria-invalid={nameError} aria-describedby={nameError ? `${nameId}-error` : undefined}
              value={contactName} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            {nameError && <p id={`${nameId}-error`} className="mt-1 text-xs text-red-700">{t("checkout.nameRequired")}</p>}
          </div>
          <div>
            <label htmlFor={emailId} className="block text-sm font-semibold">{t("common.email")}</label>
            <Input id={emailId} className={`mt-1.5 ${inputStyles}`} type="email" autoComplete="email" required disabled={buy.isPending}
              status={emailError ? "error" : undefined} aria-invalid={emailError} aria-describedby={emailError ? `${emailId}-error` : undefined}
              value={contactEmail} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            {emailError && <p id={`${emailId}-error`} className="mt-1 text-xs text-red-700">{t("validation.email")}</p>}
          </div>
        </div>}
      </form>
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
          <div className="mt-1 flex flex-wrap gap-2">
            <Input id="promo-code" autoComplete="off" maxLength={64} value={codeInput} disabled={buy.isPending}
              aria-invalid={Boolean(promo && quote.isError)} aria-describedby={promo && quote.isError ? "promo-error" : undefined}
              className={`min-w-32 flex-1 ${inputStyles}`} onChange={(e) => setCodeInput(e.target.value)} />
            <Button htmlType="submit" disabled={!codeInput.trim() || buy.isPending} loading={quote.isFetching}>
              {t("promo.apply")}
            </Button>
          </div>
        </form>
        {promo && <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" className="min-w-0 break-words text-xs text-muted-strong">
            {quote.isFetching ? t("promo.checking") : quoted && t("promo.applied", { code: quoted.code })}
          </div>
          <Button size="small" disabled={buy.isPending} onClick={() => {
            setCodeInput("");
            setAppliedCode(null);
            removeCampaignToken();
            buy.reset();
          }}>{t("promo.remove")}</Button>
        </div>}
        {promo && quote.isError && <Alert id="promo-error" role="alert" type="warning" showIcon
          title={errorMessage(quote.error, t("promo.quoteError"))}
          action={!(quote.error instanceof ApiError && quote.error.status === 409) &&
            <Button size="small" onClick={() => void quote.refetch()}>{t("common.retry")}</Button>} />}
      </div>}
      <dl className="mt-4 space-y-2 border-t border-line-soft pt-4 text-sm">
        {(subtotal > 0 || quoted) && <>
          <div className="flex justify-between gap-3 text-muted">
            <dt>{t("booking.subtotal")}</dt><dd>{formatMinor(quoted?.subtotal_minor ?? subtotal, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-[#027A48]">
            <dt>{t("promo.discount")}</dt><dd>{formatMinor(0 - (quoted?.discount_minor ?? 0), locale)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-muted">
            <dt>{t("checkout.processingFee")}</dt>
            <dd>{feeMinor === null ? t("checkout.feeIncluded") : formatMinor(feeMinor, locale)}</dd>
          </div>
        </>}
        <div className="flex items-center justify-between gap-3">
          <dt>{t("checkout.total")}</dt><dd className="text-lg font-bold">{formatMinor(totalMinor, locale)}</dd>
        </div>
      </dl>
      {total >= MAX_TICKETS_PER_ORDER && <p className="mt-2 text-xs text-muted">{t("booking.orderLimit", { limit: MAX_TICKETS_PER_ORDER })}</p>}
      {selectionUnavailable && <p role="alert" className="mt-2 text-xs text-primary-hover">{t("checkout.selectionUnavailable")}</p>}
      <Button type="primary" htmlType="submit" form={formId} block className="mt-4" disabled={!canSubmit} loading={buy.isPending}>
        {totalMinor > 0 ? t("checkout.continueToPayment") : t("checkout.register")}
      </Button>
      {buy.isError && buy.error.message !== quote.error?.message && <Alert role="alert" type="error" showIcon className="mt-3"
        title={errorMessage(buy.error, t("eventWorkflow.networkError"))} />}
    </aside>
  );
};
