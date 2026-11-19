import { Outlet, ScrollRestoration } from "react-router-dom";

import { Footer } from "./ui/Footer/Footer";
import { Header } from "./ui/Header/Header";

export const Layout = () => {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <div className="flex-1">
        <Outlet />
      </div>

      <Footer />
      <ScrollRestoration />
    </div>
  );
};
