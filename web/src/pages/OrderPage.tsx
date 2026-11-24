import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal } from "antd";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OrderCard } from "../features/Orders/ui/OrderCard";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { ApiError } from "../shared/api/auth";
import { ordersApi, type Order } from "../shared/api/events";
import { formatMinor } from "../shared/lib/formatPrice";
import { parseApiInstant } from "../shared/lib/parseApiInstant";
import { randomId } from "../shared/lib/randomId";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";

export const OrderPage = () => {
  const { t } = useTranslation();
  const { orderNumber = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token");
  const { me } = useAuth();
  const ownerId = token ? null : me.data?.id ?? null;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [orderNumber]);

  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-7 sm:py-10">
    <Link to="/" className="text-sm text-muted">{t("common.backToEvents")}</Link>
    <h1 ref={heading} tabIndex={-1} className="mt-3 page-title">{t("orders.title")}</h1>
    <OrderDetails key={JSON.stringify([orderNumber, token, ownerId])}
      orderNumber={orderNumber} token={token} ownerId={ownerId} waitingForSession={!token && me.isPending} />
  </main>;
};

type OrderAction = "succeed" | "fail" | "cancel";

const OrderDetails = ({ orderNumber, token, ownerId, waitingForSession }: {
  orderNumber: string; token: string | null; ownerId: number | null; waitingForSession: boolean;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const paymentKeys = useRef<Partial<Record<"succeed" | "fail", string>>>({});
  const submitting = useRef(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const [cancelRegistration, setCancelRegistration] = useState(false);
  const queryKey = ["orders", "detail", orderNumber, token, ownerId];
  const order = useQuery({
    queryKey, queryFn: () => ordersApi.get(orderNumber, token), enabled: !waitingForSession, retry: false,
    refetchInterval: ({ state: { data } }) => data?.status === "pending" && data.expires_at
      && parseApiInstant(data.expires_at) <= Date.now() ? 5_000 : false,
  });
  const act = useMutation({
    mutationFn: (action: OrderAction) => action === "cancel"
      ? ordersApi.cancel(orderNumber, token)
      : ordersApi.pay(orderNumber, token, paymentKeys.current[action] ??= randomId(), action),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
      setCancelRegistration(false);
    },
    onError: () => queryClient.invalidateQueries({ queryKey }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["orders", "mine"] });
      submitting.current = false;
    },
  });
  const run = (action: OrderAction) => {
    if (submitting.current) return;
    submitting.current = true;
    act.mutate(action);
  };
  const paymentConfirmed = act.isSuccess && act.variables === "succeed" && order.data?.status === "confirmed";
  const paymentDeclined = act.variables === "fail" && act.error instanceof ApiError && act.error.status === 402;
  useEffect(() => { if (paymentConfirmed) confirmation.current?.focus(); }, [paymentConfirmed]);

  const freeRegistration = order.data?.status === "confirmed" && order.data.total_minor === 0;

  return (
    <>
      {order.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted">
        <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("common.loading")}
      </div> : order.isError ? <Alert className="mt-6" type="error" showIcon
        title={t(order.error instanceof ApiError && order.error.status === 404 ? "orders.notFound" : "errors.unavailable")}
        action={<Button size="small" loading={order.isFetching} onClick={() => void order.refetch()}>{t("common.retry")}</Button>} />
        : <div className="mt-6 space-y-4">
          <div ref={confirmation} tabIndex={-1} role="status" className="empty:sr-only">
            {order.data.status === "confirmed" && <Alert type="success" showIcon role="presentation" title={t("orders.confirmed")}
              description={token ? t("orders.keepLink") : undefined} />}
          </div>
          {order.data.status === "pending" && <PaymentControls key={order.data.expires_at} order={order.data}
            pendingAction={act.isPending ? act.variables : undefined} onAction={run} refresh={order.refetch} />}
          {freeRegistration && <Button danger disabled={act.isPending} onClick={() => {
            act.reset();
            setCancelRegistration(true);
          }}>{t("checkout.cancelRegistration")}</Button>}
          <Modal open={freeRegistration && cancelRegistration} title={t("checkout.cancelRegistration")}
            okText={t("checkout.confirmCancellation")} cancelText={t("checkout.keepRegistration")}
            okButtonProps={{ danger: true }} cancelButtonProps={{ disabled: act.isPending }}
            closable={!act.isPending} keyboard={!act.isPending} mask={{ closable: false }} confirmLoading={act.isPending}
            onCancel={() => { if (!act.isPending) setCancelRegistration(false); }} onOk={() => run("cancel")}>
            <p>{t("checkout.cancelRegistrationDescription")}</p>
            {act.isError && <Alert className="mt-3" type="error" showIcon title={errorMessage(act.error, t("eventWorkflow.networkError"))} />}
          </Modal>
          {act.isError && !cancelRegistration && <Alert role="alert" type="error" showIcon
            title={paymentDeclined ? t("checkout.paymentDeclined") : errorMessage(act.error, t("eventWorkflow.networkError"))} />}
          {order.data.status === "expired" && <Alert type="warning" showIcon title={t("checkout.holdExpired")} />}
          <OrderCard order={order.data} access={{ token }} />
        </div>}
    </>
  );
};

const PaymentControls = ({ order, pendingAction, onAction, refresh }: {
  order: Order;
  pendingAction?: OrderAction;
  onAction: (action: OrderAction) => void;
  refresh: () => Promise<unknown>;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const expiry = order.expires_at ? parseApiInstant(order.expires_at) : NaN;
  const readSeconds = () => Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(readSeconds);
  const expired = seconds === 0;
  const refreshed = useRef(false);

  useEffect(() => {
    if (expired || !Number.isFinite(expiry)) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
    const timer = window.setInterval(update, 250);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [expired, expiry]);

  useEffect(() => {
    if (expired && !pendingAction && !refreshed.current) {
      refreshed.current = true;
      void refresh();
    }
  }, [expired, pendingAction, refresh]);

  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`.padStart(5, "0");
  const disablePayment = Boolean(pendingAction) || expired;
  const pay = (action: "succeed" | "fail") => {
    if (readSeconds() === 0) setSeconds(0);
    else onAction(action);
  };

  return <div className="space-y-3">
    <Alert type="warning" showIcon title={t(expired ? "checkout.holdExpired" : "orders.awaitingPayment")}
      description={Number.isFinite(seconds) && !expired && <span className="flex flex-wrap items-center gap-2">
        {t("checkout.holdRemaining")}
        <span role="timer" className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-mono font-bold tabular-nums">{remaining}</span>
      </span>} />
    <div className="flex flex-wrap gap-2">
      <Button type="primary" disabled={disablePayment} loading={pendingAction === "succeed"}
        onClick={() => pay("succeed")}>{t("checkout.paySimulated", { amount: formatMinor(order.total_minor, locale) })}</Button>
      <Button danger disabled={disablePayment} loading={pendingAction === "fail"}
        onClick={() => pay("fail")}>{t("checkout.simulateFailure")}</Button>
      {!expired && <Button disabled={Boolean(pendingAction)} loading={pendingAction === "cancel"}
        onClick={() => onAction("cancel")}>{t("orders.cancel")}</Button>}
    </div>
    {!expired && <p className="text-xs text-muted">{t("checkout.simulatedNote")}</p>}
  </div>;
};
