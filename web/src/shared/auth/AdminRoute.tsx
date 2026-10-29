import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../hooks/useAuth";

export const AdminRoute = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const location = useLocation();
  if (me.isPending) return <div role="status" className="p-10 text-center">{t("ops.loading")}</div>;
  if (me.isError) return <div role="alert" className="p-10 text-center">
    <p>{t("errors.sessionCheck")}</p>
    <button type="button" className="mt-3 font-semibold text-[#A93216]" onClick={() => void me.refetch()}>{t("ops.retry")}</button>
  </div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!me.data.is_platform_admin) return <main className="grid min-h-[50vh] place-items-center bg-[#F5F5F0] p-6">
    <div className="max-w-md text-center">
      <h1 className="text-2xl font-bold">{t("ops.adminOnly")}</h1>
      <p className="mt-3 text-sm text-[#667085]">{t("ops.forbidden")}</p>
      <Link to="/account" className="mt-5 inline-block font-semibold text-[#A93216]">{t("ops.account")}</Link>
    </div>
  </main>;
  return <Outlet />;
};
