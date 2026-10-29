import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HomePage } from "./pages/MainPage";
import { EventPage } from "./pages/EventPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AccountPage } from "./pages/AccountPage";
import { GuestRoute, ProtectedRoute } from "./shared/auth/RouteGuards";
import { Layout } from "./shared/Layout/Layout";
import { OrganizerProfilePage } from "./pages/OrganizerProfilePage";
import { OrganizerRoute } from "./shared/auth/OrganizerRoute";
import { OrganizerEventPage } from "./pages/OrganizerEventPage";
import { OrganizerEventsPage } from "./pages/OrganizerEventsPage";
import { OrganizerEventPreviewPage } from "./pages/OrganizerEventPreviewPage";
import { OrderPage } from "./pages/OrderPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { StaffEventsPage } from "./pages/StaffEventsPage";
import { StaffEventPage } from "./pages/StaffEventPage";
import { AdminEventsPage } from "./pages/AdminEventsPage";
import { AdminEventPage } from "./pages/AdminEventPage";
import { AdminRoute } from "./shared/auth/AdminRoute";

function App() {
  const router = createBrowserRouter([
    {
      element: <OrganizerRoute />,
      children: [
        { path: "/organizer/events", element: <OrganizerEventsPage /> },
        { path: "/organizer/events/:eventId/preview", element: <OrganizerEventPreviewPage /> },
        { path: "/organizer/events/new", element: <OrganizerEventPage /> },
        { path: "/organizer/events/:eventId/edit", element: <OrganizerEventPage /> },
      ],
    },
    {
      // Any signed-in account: saving this profile is how one becomes an organizer.
      element: <OrganizerRoute requireProfile={false} />,
      children: [{ path: "/organizer/profile", element: <OrganizerProfilePage /> }],
    },
    {
      element: <GuestRoute />,
      children: [
        { path: "/login", element: <LoginPage /> },
        { path: "/signup", element: <SignupPage /> },
      ],
    },
    {
      path: "/forgot-password",
      element: <ForgotPasswordPage />,
    },
    {
      path: "/reset-password",
      element: <ResetPasswordPage />,
    },
    { path: "/verify-email", element: <VerifyEmailPage /> },
    {
      element: <Layout />,
      children: [
        {
          element: <ProtectedRoute />,
          children: [
            { path: "/account", element: <AccountPage /> },
            { path: "/staff/events", element: <StaffEventsPage /> },
            { path: "/staff/events/:eventId", element: <StaffEventPage /> },
          ],
        },
        {
          element: <AdminRoute />,
          children: [
            { path: "/admin/events", element: <AdminEventsPage /> },
            { path: "/admin/events/:eventId", element: <AdminEventPage /> },
          ],
        },
        {
          path: "/",
          element: <HomePage />,
        },
        { path: "/events/:slug", element: <EventPage /> },
        { path: "/orders/:orderNumber", element: <OrderPage /> },
      ],
    },
  ]);

  return <RouterProvider router={router}></RouterProvider>;
}

export default App;
