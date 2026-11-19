import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";

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
