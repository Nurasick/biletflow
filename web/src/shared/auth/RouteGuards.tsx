import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";

const SessionLoader = () => (
  <div className="grid min-h-screen place-items-center bg-[#F5F5F0] text-[#101828]">
    <div className="flex items-center gap-2 text-sm text-[#667085]">
      <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} />
      Checking your session…
    </div>
  </div>
);

const SessionError = ({ retry }: { retry: () => void }) => (
  <div className="grid min-h-screen place-items-center bg-[#F5F5F0] text-[#101828]">
    <div role="alert" className="text-center">
      <p>Unable to check your sign-in status. Please try again.</p>
      <button type="button" onClick={retry} className="mt-3 font-semibold text-[#D9431F]">
        Try again
      </button>
    </div>
  </div>
);

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
