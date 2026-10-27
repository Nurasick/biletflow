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

function App() {
  const router = createBrowserRouter([
    {
      element: <OrganizerRoute />,
      children: [
        { path: "/organizer/events", element: <OrganizerEventsPage /> },
        { path: "/organizer/events/:eventId/preview", element: <OrganizerEventPreviewPage /> },
        { path: "/organizer/profile", element: <OrganizerProfilePage /> },
        { path: "/organizer/events/new", element: <OrganizerEventPage /> },
      ],
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
    {
      element: <Layout />,
      children: [
        {
          element: <ProtectedRoute />,
          children: [{ path: "/account", element: <AccountPage /> }],
        },
        {
          path: "/",
          element: <HomePage />,
        },
        {
          path: "/events",
          element: <EventPage />,
        },
      ],
    },
  ]);

  return <RouterProvider router={router}></RouterProvider>;
}

export default App;
