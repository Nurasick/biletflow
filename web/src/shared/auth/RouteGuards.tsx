import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";
import { useStaffAccess } from "./useStaffAccess";

const SessionLoader = () => {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen place-items-center bg-paper text-ink">
      <div className="flex items-center gap-2 text-sm text-muted">
        <LoaderCircle className="animate-spin text-primary" size={18} />
        {t("errors.checkingSession")}
      </div>
    </div>
  );
};

const SessionError = ({ retry }: { retry: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen place-items-center bg-paper text-ink">
      <div role="alert" className="text-center">
        <p>{t("errors.sessionCheck")}</p>
        <button type="button" onClick={retry} className="mt-3 font-semibold text-primary-hover">
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
};

export const ProtectedRoute = () => {
  const location = useLocation();
  const { me } = useAuth();

  if (me.isPending) return <SessionLoader />;
  if (me.isError) return <SessionError retry={() => void me.refetch()} />;

  if (!me.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  return <Outlet />;
};

export const StaffRoute = ({ area }: { area: "checkIn" | "support" }) => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const access = useStaffAccess(me.data);
  const allowed = area === "support" ? access.canHandleSupport : access.canCheckIn;

  if (allowed) return <Outlet />;
  if (access.isPending) {
    return <p role="status" className="site-container py-12 text-center text-sm text-muted">{t("ops.loading")}</p>;
  }
  if (access.isError) {
    return (
      <main className="site-container py-12 text-center">
        <p role="alert" className="text-sm text-muted">{t("booking.staffAccessCheckFailed")}</p>
        <button type="button" className="action-button mt-4" onClick={access.retry}>{t("common.retry")}</button>
      </main>
    );
  }

  return (
    <main className="site-container py-12 text-center sm:py-20">
      <h1 className="page-title">{t("booking.staffAccessRequired")}</h1>
      <p className="mt-3 text-sm text-muted">{t("ops.forbidden")}</p>
      <Link to="/account" className="action-button action-button--primary mt-5">{t("auth.backToAccount")}</Link>
    </main>
  );
};

export const GuestRoute = () => {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from?.startsWith("/") && !from.startsWith("//") ? from : "/account";
  const { me } = useAuth();

  if (me.isPending) return <SessionLoader />;
  if (me.isError) return <SessionError retry={() => void me.refetch()} />;
  if (me.data) return <Navigate to={destination} replace />;

  return <Outlet />;
};
