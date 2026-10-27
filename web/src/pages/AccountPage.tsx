import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { OrderCard } from "../features/Orders/ui/OrderCard";
import { ordersApi } from "../shared/api/events";

export const AccountPage = () => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { me, logout } = useAuth();
  const user = me.data;
  // Order history and tickets (audit #13). Cancellation of confirmed orders
  // is the organizer's (§4.9); a pending one can be dropped on its order page.
  const orders = useQuery({ queryKey: ["orders", "mine", user?.id], queryFn: ordersApi.mine, enabled: Boolean(user) });
  if (!user) return null;

  return (
    <main className="mx-auto w-full max-w-3xl px-7 py-12">
      <h1 className="text-3xl font-bold">{t("account.title")}</h1>
      <Link to={user.is_organizer ? "/organizer/events" : "/organizer/profile"} className="mt-4 inline-block text-sm font-semibold text-[#D9431F]">{t(user.is_organizer ? "account.organizerWorkspace" : "account.becomeOrganizer")}</Link>
      <dl className="my-8 space-y-4">
        <div><dt className="text-sm text-[#667085]">{t("account.name")}</dt><dd>{user.first_name} {user.last_name}</dd></div>
        <div><dt className="text-sm text-[#667085]">{t("account.email")}</dt><dd>{user.email}</dd></div>
      </dl>
      <section aria-labelledby="my-orders" className="my-10">
        <h2 id="my-orders" className="text-xl font-bold">{t("nav.myTickets")}</h2>
        {orders.isPending ? <p className="mt-3 text-sm text-[#667085]">{t("eventWorkflow.loading")}</p>
          : orders.isError ? <p role="alert" className="mt-3 text-sm">{t("errors.unavailable")}</p>
          : orders.data.length === 0 ? <p className="mt-3 text-sm text-[#667085]">{t("orders.none")}</p>
          : <div className="mt-4 space-y-4">{orders.data.map((order) => <OrderCard key={order.order_number}
              order={order} showQr={false} detailHref={`/orders/${order.order_number}`} />)}</div>}
      </section>
      {logout.isError && <p role="alert" className="mb-4 text-red-600">{getAuthErrorMessage(logout.error, t("errors.signOut"))}</p>}
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        className="rounded-xl bg-[#FF5C35] px-5 py-3 font-semibold disabled:opacity-50"
      >
        {logout.isPending ? t("account.signingOut") : t("account.signOut")}
      </button>
    </main>
  );
};
