import { Outlet } from "react-router-dom";

import { Footer } from "./ui/Footer/Footer";
import { Header } from "./ui/Header/Header";
import { UtilityBar } from "./ui/UtilityBar/UtilityBar";

export const Layout = () => {
  return (
    <div className="flex min-h-screen flex-col bg-white text-[#101828]">
      <UtilityBar />
      <Header />

      <div className="flex-1">
        <Outlet />
      </div>

      <Footer />
    </div>
  );
};
