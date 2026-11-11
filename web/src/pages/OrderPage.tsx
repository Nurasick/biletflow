import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OrderCard } from "../features/Orders/ui/OrderCard";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { ApiError } from "../shared/api/auth";
import { ordersApi } from "../shared/api/events";
import { formatMinor } from "../shared/lib/formatPrice";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";

export const OrderPage = () => {
  const { orderNumber = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token");
  const { me } = useAuth();
  const ownerId = token ? null : me.data?.id ?? null;
  return <OrderDetails key={JSON.stringify([orderNumber, token, ownerId])}
    orderNumber={orderNumber} token={token} ownerId={ownerId} waitingForSession={!token && me.isPending} />;
};

const OrderDetails = ({ orderNumber, token, ownerId, waitingForSession }: {
  orderNumber: string; token: string | null; ownerId: number | null; waitingForSession: boolean;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const paymentKey = useRef<string | null>(null);
  const queryKey = ["orders", "detail", orderNumber, token, ownerId];
  const order = useQuery({
    queryKey, queryFn: () => ordersApi.get(orderNumber, token), enabled: !waitingForSession, retry: false,
  });
  const act = useMutation({
    mutationFn: (action: "pay" | "cancel") => action === "pay"
      ? ordersApi.pay(orderNumber, token, paymentKey.current ??= crypto.randomUUID())
      : ordersApi.cancel(orderNumber, token),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (updated) => { queryClient.setQueryData(queryKey, updated); },
    onError: () => queryClient.invalidateQueries({ queryKey }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });

  const expiresAt = order.data?.expires_at;
  const expiry = expiresAt && new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: order.data?.event.timezone,
  }).format(new Date(expiresAt));

  return (
    <main className="mx-auto w-full max-w-3xl px-7 py-10">
      <Link to="/" className="text-sm text-[#667085]">{t("common.backToEvents")}</Link>
      <h1 className="mt-3 text-3xl font-bold">{t("orders.title")}</h1>
      {order.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-[#667085]">
        <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("common.loading")}
      </div> : order.isError ? <Alert className="mt-6" type="error" showIcon
        title={t(order.error instanceof ApiError && order.error.status === 404 ? "orders.notFound" : "errors.unavailable")}
        action={<Button size="small" loading={order.isFetching} onClick={() => void order.refetch()}>{t("common.retry")}</Button>} />
        : <div className="mt-6 space-y-4">
          {order.data.status === "confirmed" && <Alert type="success" showIcon title={t("orders.confirmed")}
            description={token ? t("orders.keepLink") : undefined} />}
          {order.data.status === "pending" && <div className="space-y-3">
            <Alert type="warning" showIcon title={t("orders.awaitingPayment")}
              description={expiry ? t("orders.heldUntil", { date: expiry, zone: order.data.event.timezone }) : undefined} />
            <div className="flex flex-wrap gap-2">
              <Button type="primary" disabled={act.isPending} loading={act.isPending && act.variables === "pay"}
                onClick={() => act.mutate("pay")}>{t("checkout.paySimulated", { amount: formatMinor(order.data.total_minor, locale) })}</Button>
              <Button disabled={act.isPending} loading={act.isPending && act.variables === "cancel"}
                onClick={() => act.mutate("cancel")}>{t("orders.cancel")}</Button>
            </div>
            <p className="text-xs text-[#667085]">{t("checkout.simulatedNote")}</p>
          </div>}
          {act.isError && <Alert role="alert" type="error" showIcon
            title={errorMessage(act.error, t("eventWorkflow.networkError"))} />}
          <OrderCard order={order.data} access={{ token }} />
        </div>}
    </main>
  );
};
