import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal } from "antd";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import { salesApi } from "../../../shared/api/eventManagement";
import type { OrganizerOrder } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";

// §4.6 gross/refunds/payout, §4.15 capacity and attendance, §4.9 cancel and
// refund. Every amount is simulated money, and the panel says so.
export const EventSalesPanel = ({ eventId }: { eventId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: ["organizer", "summary", eventId], queryFn: () => salesApi.summary(eventId) });
  const orders = useQuery({ queryKey: ["organizer", "orders", eventId], queryFn: () => salesApi.orders(eventId) });
  const [target, setTarget] = useState<OrganizerOrder | null>(null);
  const settle = useMutation({
    mutationFn: (order: OrganizerOrder) => order.total_minor > 0
      ? salesApi.refund(eventId, order.order_number, "Refunded by the organizer")
      : salesApi.cancel(eventId, order.order_number),
    onSuccess: async () => {
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["organizer", "summary", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["organizer", "orders", eventId] });
    },
  });
  const money = (minor: number) => formatMinor(minor, locale);

  return (
    <section aria-labelledby="sales" className="rounded-xl border border-[#D0D5DD] bg-white p-5">
      <h2 id="sales" className="flex items-center gap-2 font-semibold"><BarChart3 size={18} aria-hidden="true" />{t("sales.title")}</h2>
      {summary.data && <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {[
          ["sales.sold", `${summary.data.tickets_sold} / ${summary.data.capacity}`],
          ["sales.checkedIn", `${summary.data.attendance.checked_in} / ${summary.data.attendance.registered}`],
          ["sales.gross", money(summary.data.gross_minor)],
          ["sales.payout", money(summary.data.estimated_payout_minor)],
        ].map(([label, value]) => <div key={label}>
          <dt className="text-xs text-[#667085]">{t(label as "sales.sold")}</dt>
          <dd className="mt-1 text-lg font-semibold">{value}</dd>
        </div>)}
      </dl>}
      {summary.data?.is_simulated && <p className="mt-2 text-xs text-[#667085]">{t("sales.simulated")}</p>}
      <h3 className="mt-6 text-sm font-semibold">{t("sales.orders")}</h3>
      {orders.data?.length === 0 && <p className="mt-2 text-sm text-[#667085]">{t("sales.noOrders")}</p>}
      <ul className="mt-2 divide-y divide-[#EAECF0]">
        {orders.data?.map((order) => <li key={order.order_number} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold">{order.contact_name} <span className="font-mono text-xs text-[#667085]">{order.order_number}</span></p>
            <p className="text-xs text-[#667085]">{t("sales.orderLine", { count: order.ticket_count })} · {money(order.total_minor)} · {t(`orderStatus.${order.status}`)}</p>
          </div>
          {order.status === "confirmed" && <Button size="small" danger onClick={() => { settle.reset(); setTarget(order); }}>
            {t(order.total_minor > 0 ? "sales.refund" : "sales.cancelRegistration")}
          </Button>}
        </li>)}
      </ul>
      <Modal open={target !== null} title={target ? t(target.total_minor > 0 ? "sales.refund" : "sales.cancelRegistration") : ""}
        okText={t("sales.confirm")} okButtonProps={{ danger: true }} confirmLoading={settle.isPending}
        onCancel={() => setTarget(null)} onOk={() => { if (target) settle.mutate(target); }}>
        <p>{t("sales.confirmDescription", { order: target?.order_number ?? "" })}</p>
        {settle.error && <Alert role="alert" type="error" showIcon className="mt-3"
          title={settle.error instanceof ApiError ? settle.error.message : t("eventWorkflow.networkError")} />}
      </Modal>
    </section>
  );
};
