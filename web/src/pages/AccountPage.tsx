import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Modal } from "antd";
import { Bell, CalendarPlus, LifeBuoy, LogOut, MessageCircle, ScanLine, Shield, Ticket } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { OrderCard } from "../features/Orders/ui/OrderCard";
import { EmailVerificationBanner } from "../features/Auth/ui/EmailVerificationBanner";
import { ordersApi } from "../shared/api/events";
import { useStaffAccess } from "../shared/auth/useStaffAccess";
import { AccountForm } from "../features/Account";
import type { AccountEditingState } from "../features/Account";

export const AccountPage = () => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { me, logout } = useAuth();
  const [accountEditing, setAccountEditing] = useState<AccountEditingState>({ isDirty: false, isSubmitting: false });
  const user = me.data;
  const { canCheckIn, canHandleSupport } = useStaffAccess(user);
  const orders = useQuery({ queryKey: ["orders", "mine", user?.id], queryFn: ordersApi.mine, enabled: Boolean(user) });
  if (!user) return null;

  return (
    <main className="site-container py-6 sm:py-9">
      <div className="brand-art flex flex-wrap items-center gap-4 rounded-[1.6rem] px-5 py-7 text-white sm:gap-6 sm:p-9">
        <span className="grid size-15 shrink-0 place-items-center rounded-2xl bg-lime text-xl font-extrabold text-stage sm:size-18 sm:text-2xl" aria-hidden="true">
          {user.first_name.slice(0, 1)}{user.last_name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="page-title">{t("account.title")}</h1>
          <p className="mt-2 font-medium text-[#e2d9fb] wrap-anywhere">{user.first_name} {user.last_name} · {user.email}</p>
        </div>
      </div>
      <div className="mt-5">
        <EmailVerificationBanner user={user} signedIn />
      </div>
      <nav aria-label={t("account.title")} className="mt-5 flex flex-wrap gap-2.5">
        <Link to={user.is_organizer ? "/organizer/events" : "/organizer/profile"} className="action-button action-button--primary">
          <CalendarPlus size={17} aria-hidden="true" />{t(user.is_organizer ? "account.organizerWorkspace" : "account.becomeOrganizer")}
        </Link>
        <Link to="/notifications" className="action-button"><Bell size={17} aria-hidden="true" />{t("notifications.title")}</Link>
        <Link to="/support" className="action-button"><LifeBuoy size={17} aria-hidden="true" />{t("common.help")}</Link>
        {canCheckIn && <Link to="/staff/events" className="action-button"><ScanLine size={17} aria-hidden="true" />{t("nav.checkIn")}</Link>}
        {canHandleSupport && <Link to="/staff/support" className="action-button"><MessageCircle size={17} aria-hidden="true" />{t("support.queue")}</Link>}
        {user.is_platform_admin && <Link to="/admin" className="action-button"><Shield size={17} aria-hidden="true" />{t("nav.admin")}</Link>}
      </nav>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <AccountForm key={user.id} user={user} onEditingChange={setAccountEditing} />
        <section aria-labelledby="my-orders" className="panel min-w-0 p-5 sm:p-7">
          <h2 id="my-orders" className="flex items-center gap-2 text-xl font-extrabold tracking-tight"><Ticket size={21} className="text-primary" aria-hidden="true" />{t("nav.myTickets")}</h2>
          {orders.isPending ? <p role="status" className="mt-3 text-sm text-muted">{t("common.loading")}</p>
            : orders.isError ? (
              <div role="alert" className="mt-3 space-y-3 text-sm text-muted">
                <p>{t("errors.unavailable")}</p>
                <button type="button" className="action-button" onClick={() => void orders.refetch()}>{t("common.retry")}</button>
              </div>
            ) : orders.data.length === 0 ? (
              <div className="mt-4 rounded-xl bg-paper p-4">
                <p className="text-sm text-muted">{t("orders.none")}</p>
                <Link to="/" className="action-button mt-4">{t("catalogue.browse")}</Link>
              </div>
            ) : <div className="mt-4 space-y-4">{orders.data.map((order) => <OrderCard key={order.order_number}
                order={order} showQr={false} showCalendar detailHref={`/orders/${order.order_number}`} />)}</div>}
        </section>
      </div>
      {logout.isError && <p role="alert" className="mt-4 text-red-700">{getAuthErrorMessage(logout.error, t("errors.signOut"))}</p>}
      <button
        type="button"
        disabled={logout.isPending || accountEditing.isSubmitting}
        onClick={() => {
          if (!accountEditing.isDirty) { logout.mutate(); return; }
          Modal.confirm({
            title: t("accountEdit.leaveTitle"), content: t("accountEdit.leaveDescription"),
            okText: t("account.signOut"), cancelText: t("accountEdit.keepEditing"),
            okButtonProps: { danger: true }, onOk: () => logout.mutateAsync(),
          });
        }}
        className="action-button mt-6 text-red-700 hover:border-red-400 hover:text-red-800"
      >
        <LogOut size={17} aria-hidden="true" />
        {logout.isPending ? t("account.signingOut") : t("account.signOut")}
      </button>
    </main>
  );
};
