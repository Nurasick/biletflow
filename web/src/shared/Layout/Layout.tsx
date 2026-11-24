import { Outlet, ScrollRestoration } from "react-router-dom";

import { RouteTitle } from "./usePageTitle";
import { Footer } from "./ui/Footer/Footer";
import { Header } from "./ui/Header/Header";
import { MAIN_CONTENT_ID, SkipLink } from "./ui/SkipLink";

export const Layout = () => {
  return (
    <div className="flex min-h-dvh flex-col">
      <RouteTitle />
      <SkipLink />
      <Header />

      <div id={MAIN_CONTENT_ID} className="flex-1">
        <Outlet />
      </div>

      <Footer />
      <ScrollRestoration />
    </div>
  );
};
