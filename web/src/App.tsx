import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HomePage } from "./pages/MainPage";
import { EventPage } from "./pages/EventPage";
import { Layout } from "./shared/Layout/Layout";

function App() {
  const router = createBrowserRouter([
    {
      element: <Layout />,
      children: [
        {
          path: "/",
          element: <HomePage />,
        },
        {
          path: "/events", // will add /events/:id later
          element: <EventPage />,
        },
      ],
    },
  ]);

  return <RouterProvider router={router}></RouterProvider>;
}

export default App;
