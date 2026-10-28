import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OrderCard } from "../features/Orders/ui/OrderCard";
import { ApiError } from "../shared/api/auth";
import { ordersApi } from "../shared/api/events";

// /orders/:orderNumber?token=… — reachable by the owner, or by anyone holding
// the signed guest link from checkout (03-ordering.md). Bookmark-worthy for
// guests: it is their only way back to their tickets until email exists.
export const OrderPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { orderNumber = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token");
  const queryKey = ["orders", orderNumber, token];
  const order = useQuery({ queryKey, queryFn: () => ordersApi.get(orderNumber, token), retry: false });
  const act = useMutation({
    mutationFn: (action: "pay" | "cancel") => action === "pay"
      ? ordersApi.pay(orderNumber, token, crypto.randomUUID())
      : ordersApi.cancel(orderNumber, token),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-7 py-10">
      <Link to="/" className="text-sm text-[#667085]">{t("common.backToEvents")}</Link>
      <h1 className="mt-3 text-3xl font-bold">{t("orders.title")}</h1>
      {order.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-[#667085]">
        <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("eventWorkflow.loading")}
      </div> : order.isError ? <Alert className="mt-6" type="error" showIcon
        title={t(order.error instanceof ApiError && order.error.status === 404 ? "orders.notFound" : "errors.unavailable")} />
        : <div className="mt-6 space-y-4">
          {order.data.status === "confirmed" && <Alert type="success" showIcon title={t("orders.confirmed")}
            description={token ? t("orders.keepLink") : undefined} />}
          {order.data.status === "pending" && <Alert type="warning" showIcon title={t("orders.pending")}
            action={<div className="flex gap-2">
              <Button type="primary" loading={act.isPending && act.variables === "pay"} onClick={() => act.mutate("pay")}>{t("orders.pay")}</Button>
              <Button loading={act.isPending && act.variables === "cancel"} onClick={() => act.mutate("cancel")}>{t("orders.cancel")}</Button>
            </div>} />}
          {act.isError && <Alert role="alert" type="error" showIcon
            title={act.error instanceof ApiError ? act.error.message : t("eventWorkflow.networkError")} />}
          <OrderCard order={order.data} />
        </div>}
    </main>
  );
};
