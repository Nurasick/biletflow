import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";

export type OrganizerContext = { userId: number; email: string; isOrganizer: boolean };

// Identity comes from the backend session (audit #9), never a local fixture.
// `requireProfile` is off for the profile page itself: saving a profile is how
// a signed-in account becomes an organizer in the first place.
export const OrganizerRoute = ({ requireProfile = true }: { requireProfile?: boolean }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { me } = useAuth();

  if (me.isPending) {
    return <div role="status" className="grid min-h-screen place-items-center bg-paper text-sm text-muted">
      <span className="flex items-center gap-2"><LoaderCircle className="animate-spin text-primary" size={18} aria-hidden="true" />{t("errors.checkingSession")}</span>
    </div>;
  }
  if (!me.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  const isOrganizer = Boolean(me.data.is_organizer);
  if (requireProfile && !isOrganizer) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper px-6 text-ink">
        <div className="max-w-md text-center">
          <h1 className="page-title">{t("organizer.accessOnly")}</h1>
          <p className="mt-3 text-sm text-muted">{t("organizer.becomeOrganizer")}</p>
          <Link to="/organizer/profile" className="action-button action-button--primary mt-6">{t("organizer.createProfile")}</Link>
        </div>
      </main>
    );
  }

  const context: OrganizerContext = { userId: me.data.id, email: me.data.email, isOrganizer };
  return <Outlet context={context} />;
};
