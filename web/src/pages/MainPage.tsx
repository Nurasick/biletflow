import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { EventCard } from "../features/Main/ui/EventCard/EventCard";
import { Hero } from "../features/Main/ui/Hero/Hero";
import { eventsApi } from "../shared/api/events";

const CATEGORIES = ["concert", "conference", "sport", "theater", "other"] as const;

// The public catalogue: published, public events that have not ended, from the
// API (audit #2). Search text and category live in the URL so links share them.
export const HomePage = () => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const events = useQuery({
    queryKey: ["events", "public", q, category],
    queryFn: () => eventsApi.list({ q, category }),
  });
  const setCategory = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("category", value); else next.delete("category");
    setParams(next, { replace: true });
  };

  return (
    <main className="mx-auto max-w-7xl px-7 py-6">
      <Hero />
      <section className="mt-8" aria-labelledby="afisha">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="afisha" className="text-2xl font-bold tracking-tight">{t("nav.afisha")}</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("organizerEvent.category")}>
            {(["", ...CATEGORIES] as const).map((value) => <button key={value || "all"} type="button" aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${category === value
                ? "border-[#101828] bg-[#101828] text-white" : "border-[#D0D5DD] text-[#667085] hover:border-[#101828]"}`}>
              {value ? t(`organizerEvent.category.${value}`) : t("dates.all")}
            </button>)}
          </div>
        </div>
        {events.isPending ? <div role="status" className="flex items-center gap-2 py-16 text-sm text-[#667085]">
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("eventWorkflow.loading")}
        </div> : events.isError ? <div role="alert" className="py-16 text-sm">
          {t("errors.unavailable")} <button type="button" className="font-semibold text-[#D9431F]"
            onClick={() => void events.refetch()}>{t("common.retry")}</button>
        </div> : events.data.length === 0 ? <p className="py-16 text-sm text-[#667085]">{t("catalogue.empty")}</p> : (
          <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
            {events.data.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
      </section>
    </main>
  );
};
