import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../../hooks/useAuth";
import { useLocale } from "../../../../i18n/useLocale";
import { ApiError } from "../../../../shared/api/auth";
import { ordersApi } from "../../../../shared/api/events";
import type { EventDetail, PublicTicketType } from "../../../../shared/api/events";
import { formatMinor } from "../../../../shared/lib/formatPrice";

// The backend's per-request bound (schemas/order.py MAX_TICKETS_PER_ORDER).
// Each type's own max_per_order applies on top (audit #19: one policy).
export const MAX_TICKETS_PER_ORDER = 20;

type Props = { event: EventDetail; ticketTypes: PublicTicketType[]; loading: boolean };

const limitFor = (type: PublicTicketType) => Math.max(0, Math.min(type.available, type.max_per_order ?? MAX_TICKETS_PER_ORDER));

export const CheckoutPanel = ({ event, ticketTypes, loading }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [contact, setContact] = useState({ name: "", email: "" });
  const [names, setNames] = useState<Record<string, string>>({});
  const contactName = contact.name || (me.data ? `${me.data.first_name} ${me.data.last_name}` : "");
  const contactEmail = contact.email || me.data?.email || "";

  const onSale = event.status === "published" && event.phase !== "completed";
  const total = Object.values(quantities).reduce((sum, n) => sum + n, 0);
  const subtotal = ticketTypes.reduce((sum, type) => sum + type.price_minor * (quantities[type.id] ?? 0), 0);
  const purchasable = (type: PublicTicketType) => onSale && limitFor(type) > 0 && (type.price_minor === 0 || event.paid_sales_active);

  const change = (type: PublicTicketType, delta: number) => setQuantities((current) => {
    const next = Math.min(limitFor(type), Math.max(0, (current[type.id] ?? 0) + delta));
    if (total - (current[type.id] ?? 0) + next > MAX_TICKETS_PER_ORDER) return current;
    return { ...current, [type.id]: next };
  });

  const buy = useMutation({
    mutationFn: async () => {
      const order = await ordersApi.checkout(event.slug, {
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        items: ticketTypes.filter((type) => quantities[type.id]).map((type) => ({
          ticket_type_id: type.id,
          attendees: Array.from({ length: quantities[type.id] }, (_, i) => ({
            full_name: (names[`${type.id}-${i}`] ?? "").trim() || contactName.trim(),
          })),
        })),
      });
      // Paid orders come back pending; pay at once through the simulator.
      // The idempotency key makes a double submit charge once.
      if (order.status === "pending") await ordersApi.pay(order.order_number, order.access_token, crypto.randomUUID());
      return order;
    },
    onSuccess: (order) => navigate(`/orders/${order.order_number}?token=${encodeURIComponent(order.access_token)}`),
  });

  const canSubmit = total > 0 && contactName.trim() && /\S+@\S+\.\S+/.test(contactEmail) && !buy.isPending;

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
                <button type="button" aria-label={t("booking.removeTicket", { name: type.name })} disabled={!count}
                  onClick={() => change(type, -1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#D0D5DD] disabled:opacity-40">
                  <Minus size={14} aria-hidden="true" /></button>
                <span aria-live="polite" className="w-5 text-center text-sm font-semibold">{count}</span>
                <button type="button" aria-label={t("booking.addTicket", { name: type.name })} disabled={!open || count >= limitFor(type) || total >= MAX_TICKETS_PER_ORDER}
                  onClick={() => change(type, 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#D0D5DD] disabled:opacity-40">
                  <Plus size={14} aria-hidden="true" /></button>
              </div>
            </div>
            {Array.from({ length: count }, (_, i) => <Input key={i} size="small" className="mt-2" maxLength={200}
              aria-label={t("checkout.attendeeName", { number: i + 1 })} placeholder={t("checkout.attendeeName", { number: i + 1 })}
              value={names[`${type.id}-${i}`] ?? ""} onChange={(e) => setNames({ ...names, [`${type.id}-${i}`]: e.target.value })} />)}
          </li>;
        })}
      </ul>
      {total > 0 && <div className="mt-4 space-y-2">
        <Input aria-label={t("checkout.contactName")} placeholder={t("checkout.contactName")} maxLength={200}
          value={contactName} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
        <Input type="email" aria-label={t("common.email")} placeholder={t("common.emailPlaceholder")}
          value={contactEmail} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
      </div>}
      <div className="mt-4 flex items-center justify-between border-t border-[#EAECF0] pt-4 text-sm">
        <span className="text-[#667085]">{t("booking.subtotal")}</span>
        <span className="text-lg font-bold">{formatMinor(subtotal, locale)}</span>
      </div>
      {total >= MAX_TICKETS_PER_ORDER && <p className="mt-2 text-xs text-[#667085]">{t("booking.orderLimit", { limit: MAX_TICKETS_PER_ORDER })}</p>}
      <Button type="primary" block className="mt-4" disabled={!canSubmit} loading={buy.isPending} onClick={() => buy.mutate()}>
        {subtotal > 0 ? t("checkout.paySimulated", { amount: formatMinor(subtotal, locale) }) : t("checkout.register")}
      </Button>
      {subtotal > 0 && <p className="mt-2 text-xs text-[#667085]">{t("checkout.simulatedNote")}</p>}
      {buy.isError && <Alert role="alert" type="error" showIcon className="mt-3"
        title={buy.error instanceof ApiError ? buy.error.message : t("eventWorkflow.networkError")} />}
    </aside>
  );
};
