import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

import { organizerApi } from "../api/organizer";

export const OrganizerRoute = () => {
  const location = useLocation();
  const session = organizerApi.currentSession();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (session.role !== "organizer") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F5F0] px-6 text-[#101828]">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Organizer access only</h1>
          <p className="mt-3 text-sm text-[#667085]">You need an organizer profile to open this page.</p>
          <Link to="/" className="mt-6 inline-block rounded-xl bg-[#FF5C35] px-5 py-3 font-semibold">Back to events</Link>
        </div>
      </main>
    );
  }

  return <Outlet context={{ userId: session.id }} />;
};
