import { ConfigProvider } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const highlights = [
  { value: "48K+", label: "tickets issued" },
  { value: "120+", label: "live events" },
  { value: "4.9", label: "attendee rating" },
];

type AuthShellProps = {
  children: ReactNode;
  top?: ReactNode;
};

export const AuthShell = ({ children, top }: AuthShellProps) => (
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: "#FF5C35",
        colorText: "#101828",
        colorBgContainer: "#F5F5F0",
        colorBorder: "#D0D5DD",
        borderRadius: 9,
        controlHeight: 46,
        fontSize: 13,
      },
      components: { Checkbox: { borderRadiusSM: 4 } },
    }}
  >
    <main className="grid min-h-screen bg-[#F5F5F0] text-[#101828] lg:grid-cols-[43%_57%]">
      <section className="relative flex min-h-[250px] flex-col overflow-hidden bg-[#101828] px-7 py-7 text-[#F5F5F0] sm:px-10 sm:py-9 lg:min-h-screen">
        <div
          aria-hidden="true"
          className="absolute -right-40 -top-40 h-80 w-80 rounded-full border-[74px] border-[#FF5C35]/15"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-20 -left-24 h-48 w-48 rounded-full border border-white/10"
        />

        <Link
          to="/"
          aria-label="BiletFlow home"
          className="relative z-10 w-fit text-[23px] font-bold tracking-[-0.03em]"
        >
          Bilet<span className="text-[#FF5C35]">Flow</span>
        </Link>

        <div className="relative z-10 my-auto max-w-[330px] py-10 lg:pb-7 lg:pt-16">
          <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[#FF8B70]">
            DISCOVER · BOOK · EXPERIENCE
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.08] tracking-[-0.045em]">
            Every great night starts with a ticket.
          </h1>
          <p className="mt-4 text-[13.5px] leading-[1.65] text-[#98A2B3]">
            Keep all your events, seats and checkout details in one secure place.
          </p>

          <div className="mt-7 hidden grid-cols-3 gap-2.5 sm:grid">
            {highlights.map((item) => (
              <div
                key={item.label}
                className="h-[78px] rounded-xl border border-[#344054] bg-[#182230] p-3"
              >
                <p className="text-lg font-bold text-white">{item.value}</p>
                <p className="mt-1 text-[10px] leading-4 text-[#98A2B3]">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 hidden items-center gap-2 text-[11px] text-[#98A2B3] lg:flex">
          <span className="h-[7px] w-[7px] rounded-full bg-[#35B887]" />
          Payments and tickets protected
        </div>
      </section>

      <section className="flex min-h-screen flex-col px-6 py-7 sm:px-12 lg:px-14 lg:py-8">
        <div className="flex min-h-5 items-center justify-center text-[11px] text-[#667085] sm:justify-end">
          {top}
        </div>

        <div className="mx-auto my-auto w-full max-w-[390px] py-10">
          {children}
        </div>

        <footer className="flex justify-center gap-4 text-[9.5px] text-[#667085]">
          <button type="button" className="font-semibold text-[#101828]">
            EN
          </button>
          <button type="button">RU</button>
          <button type="button">KZ</button>
          <button type="button">Help centre</button>
        </footer>
      </section>
    </main>
  </ConfigProvider>
);
