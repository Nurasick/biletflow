import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, CalendarDays, Search, Ticket, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { categoryIcons } from "../features/Main/model/eventCategories";
import { EventCard } from "../features/Main/ui/EventCard/EventCard";
import { useLocale } from "../i18n/useLocale";
import { eventsApi, type PublicEvent } from "../shared/api/events";
import { eventImageSrc } from "../shared/api/urls";
import { BrandTicket } from "../shared/ui/Brand";

const categories = ["concert", "theater", "sport", "conference", "other"] as const;

function DiscoveryHero({ featured }: { featured?: PublicEvent }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <section className="stage-focus relative isolate grid overflow-hidden rounded-[1.75rem] bg-stage text-white lg:grid-cols-[1.06fr_1fr]" aria-labelledby="discover-title">
      <div className="relative z-10 flex flex-col items-start justify-center px-6 py-9 sm:px-11 sm:py-13 lg:py-16">
        <h1 id="discover-title" className="text-[clamp(2.6rem,6vw,5.45rem)] leading-[0.99] font-extrabold tracking-[-0.075em] wrap-anywhere">
          {t("catalogue.heroTitle")}<span className="block text-lime">{t("catalogue.heroAccent")}</span>
        </h1>
        <p className="mt-5 max-w-[31rem] text-sm leading-relaxed text-[#dfd9f3] sm:text-base">{t("catalogue.heroDescription")}</p>
        <a href="#event-catalogue" className="action-button action-button--lime mt-7">
          {t("catalogue.browse")}<ArrowDown size={17} aria-hidden="true" />
        </a>
      </div>
      <div className={`brand-art grid min-w-0 place-items-center ${featured ? "p-5 pt-0 sm:p-8 lg:py-9" : "hidden min-h-68 px-12 py-10 sm:grid"}`}>
        {featured && featured.cover_image_url ? (
          <Link to={`/events/${featured.slug}`} className="group relative z-10 w-full max-w-xl overflow-hidden rounded-[1.2rem] bg-white text-ink shadow-[0_16px_40px_#120d27a0]">
            <img src={eventImageSrc(featured.cover_image_url)} alt="" fetchPriority="high"
              className="aspect-[2.25] w-full object-cover sm:aspect-[2.05]" />
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <time className="block text-xs font-bold text-primary" dateTime={featured.starts_at}>
                  {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: featured.timezone }).format(new Date(featured.starts_at))}
                </time>
                <p className="mt-0.5 text-base leading-tight font-bold tracking-tight wrap-anywhere sm:text-xl">{featured.title}</p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-wash text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                <ArrowUpRight size={19} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ) : <BrandTicket />}
      </div>
    </section>
  );
}

export const HomePage = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const searchForm = useRef<HTMLFormElement>(null);
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const filtered = Boolean(q || category);
  const events = useQuery({
    queryKey: ["events", "public", q, category],
    queryFn: () => eventsApi.list({ q, category }),
    retry: 1,
  });
  const featured = !filtered ? events.data?.find((event) => event.cover_image_url) : undefined;
  const update = (key: "q" | "category", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const clear = () => {
    searchForm.current?.reset();
    setParams({}, { replace: true, preventScrollReset: true });
  };

  return (
    <main className="site-container pt-5 pb-10 sm:pt-8 sm:pb-15">
      {!filtered && <DiscoveryHero featured={featured} />}
      <section id="event-catalogue" className={`scroll-mt-6 ${filtered ? "pt-5" : "mt-9 sm:mt-12"}`} aria-labelledby="catalogue-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {filtered
            ? <h1 id="catalogue-heading" className="page-title">{t("catalogue.results")}</h1>
            : <h2 id="catalogue-heading" className="page-title">{t("catalogue.upcoming")}</h2>}
          {events.isSuccess && events.data.length > 0 && (
            <p className="text-sm font-semibold text-muted" role="status">
              {t("catalogue.count", { count: events.data.length, formatted: new Intl.NumberFormat(locale).format(events.data.length) })}
            </p>
          )}
        </div>

        <form ref={searchForm} role="search" className="mt-5 flex min-h-[54px] max-w-2xl items-center gap-2 rounded-xl border border-line bg-white p-1.5 pl-3.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25"
          onSubmit={(event) => {
            event.preventDefault();
            update("q", new FormData(event.currentTarget).get("q")?.toString().trim() ?? "");
          }}>
          <Search size={20} className="shrink-0 text-primary" aria-hidden="true" />
          <input key={q} type="search" name="q" defaultValue={q} aria-label={t("nav.searchPlaceholder")}
            placeholder={t("nav.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted focus-visible:outline-none" />
          <button type="submit" className="action-button action-button--primary min-h-10 px-3 sm:px-5">
            <span className="hidden sm:inline">{t("nav.search")}</span>
            <span className="sr-only sm:hidden">{t("nav.search")}</span>
            <ArrowUpRight size={18} className="sm:hidden" aria-hidden="true" />
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2.5" role="group" aria-label={t("organizerEvent.category")}>
          {(["", ...categories] as const).map((value) => {
            const CategoryIcon = value ? categoryIcons[value] : CalendarDays;
            return (
              <button key={value || "all"} type="button" aria-pressed={category === value} onClick={() => update("category", value)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${category === value ? "border-primary bg-accent-wash text-primary" : "border-line bg-white text-muted-strong hover:border-primary hover:text-primary"}`}>
                <CategoryIcon size={16} aria-hidden="true" />{value ? t(`organizerEvent.category.${value}`) : t("catalogue.allCategories")}
              </button>
            );
          })}
          {filtered && <button type="button" onClick={clear} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-accent-wash">
            <X size={16} aria-hidden="true" />{t("catalogue.clear")}
          </button>}
        </div>

        {events.isPending ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status">
            <span className="sr-only">{t("common.loading")}</span>
            {[1, 2, 3].map((item) => <div key={item} aria-hidden="true" className="panel h-52 animate-pulse bg-soft" />)}
          </div>
        ) : events.isError || events.data.length === 0 ? (
          <div role={events.isError ? "alert" : "status"} className="panel mt-6 flex flex-col items-center px-6 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent-wash text-primary">
              {filtered ? <Search size={22} aria-hidden="true" /> : <Ticket size={24} aria-hidden="true" />}
            </span>
            <h3 className="mt-4 text-lg font-bold">{t(events.isError ? "catalogue.loadError" : "catalogue.empty")}</h3>
            <p className="mt-1 max-w-md text-sm text-muted">{t(events.isError ? "errors.unavailable" : filtered ? "catalogue.emptyFilters" : "catalogue.emptyUpcoming")}</p>
            {events.isError && <button type="button" className="action-button mt-5" onClick={() => void events.refetch()}>{t("common.retry")}</button>}
            {!events.isError && filtered && <button type="button" className="action-button mt-5" onClick={clear}>{t("catalogue.clear")}</button>}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {events.data.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
      </section>
    </main>
  );
};
