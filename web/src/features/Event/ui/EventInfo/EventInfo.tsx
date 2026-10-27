import { useTranslation } from "react-i18next";
export const EventInfo = () => {
  const { t } = useTranslation();
  return (
    <section className="flex gap-6">
      <div className="aspect-[2/3] w-[150px] shrink-0 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]" />

      <div className="flex-1">
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-md bg-[#F5F5F0] px-2 py-1 text-[#667085]">
            {t("event.concert")}
          </span>
          <span className="rounded-md bg-[#101828] px-2 py-1 text-white">
            16+
          </span>
          <span className="rounded-md bg-orange-50 px-2 py-1 text-[#FF5C35]">
            {t("event.assignedSeating")}
          </span>
        </div>

        <h1 className="mt-3 text-[27px] font-bold leading-tight tracking-tight">
          {t("demo.eventTitle")}
        </h1>

        <div className="mt-3 text-[13px] leading-6 text-[#667085]">
          <p>
            {t("event.duration", { count: 120 })} · KBTU Music Club{" "}
            <span className="font-bold text-[#FF5C35]">✓</span> · {t("common.events", { count: 14 })}
          </p>
          <p>{t("demo.venue")} · {t("demo.address")}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2">
            {t("event.addCalendar")}
          </button>
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2">
            {t("event.share")}
          </button>
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2 text-[#667085]">
            {t("event.refundRules")}
          </button>
        </div>
      </div>
    </section>
  );
};
