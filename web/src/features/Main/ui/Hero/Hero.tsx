import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useLocale } from "../../../../i18n/useLocale";
import { formatPrice } from "../../../../shared/lib/formatPrice";

export const Hero = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const eventDate = new Date(2026, 3, 18).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return (
    <section className="grid grid-cols-3 gap-5">
      <div className="col-span-2 flex min-h-[280px] items-end rounded-2xl border border-[#D0D5DD] bg-[#F5F5F0] p-6">
        <div className="max-w-sm rounded-xl bg-white p-5 shadow-lg">
          <div className="text-xs font-semibold tracking-wider text-[#FF5C35]">
            {t("home.featured")}
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {t("demo.eventTitle")}
          </h1>

          <p className="mt-2 text-sm text-[#667085]">
            {eventDate} · 19:00 · {t("demo.venue")}
          </p>

          <div className="mt-5 flex items-center gap-4">
            <Link
              to="/events"
              className="rounded-lg bg-[#FF5C35] px-5 py-2.5 text-sm font-semibold"
            >
              {t("home.buyTickets")}
            </Link>

            <span className="text-sm font-semibold">{t("common.fromPrice", { price: formatPrice(8500, locale) })}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex-1 rounded-xl border border-[#D0D5DD] p-5">
          <h2 className="font-semibold">{t("home.nextEvent")}</h2>

          <p className="mt-2 text-sm leading-6 text-[#667085]">
            {t("demo.eventName")}
            <br />
            {eventDate} · {t("demo.seat", { row: 3, seat: 12 })}
          </p>

          <div className="mt-4 flex gap-2">
            <button className="rounded-lg border border-[#D0D5DD] px-4 py-2 text-xs font-semibold">
              {t("home.showQr")}
            </button>

            <button className="rounded-lg border border-[#D0D5DD] px-4 py-2 text-xs font-semibold text-[#667085]">
              {t("home.calendar")}
            </button>
          </div>
        </div>

        <div className="flex-1 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] p-5">
          <h2 className="font-semibold">{t("home.organizing")}</h2>

          <p className="mt-2 text-sm leading-6 text-[#667085]">
            {t("home.organizerDescription")}
          </p>

          <Link to="/organizer/events/new" className="mt-4 inline-block text-sm font-semibold text-[#FF5C35]">
            {t("home.startEvent")}
          </Link>
        </div>
      </div>
    </section>
  );
};
