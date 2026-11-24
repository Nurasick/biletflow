import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Search, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { categoryIcons } from "../features/Main/model/eventCategories";
import {
  clearDiscovery, discoveryApiFilters, discoveryCategories, discoveryPageSize, discoveryPrices, discoverySorts, readDiscovery,
} from "../features/Main/model/eventDiscovery";
import { EventCard } from "../features/Main/ui/EventCard/EventCard";
import { useLocale } from "../i18n/useLocale";
import { eventsApi, type PublicEvent } from "../shared/api/events";
import { eventImageSrc } from "../shared/api/urls";
import { BrandTicket } from "../shared/ui/Brand";

const filterInput = "min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-base font-normal text-ink focus:border-primary";

function DiscoveryFilters({
  filters, formRef, onApply,
}: {
  filters: ReturnType<typeof readDiscovery>;
  formRef: RefObject<HTMLFormElement | null>;
  onApply: (form: FormData) => void;
}) {
  const { t } = useTranslation();
  const [dateError, setDateError] = useState(Boolean(filters.from && filters.to && filters.from > filters.to));

  return (
    <form ref={formRef} className="panel mt-4 p-3.5 sm:p-4" aria-label={t("booking.discoveryFilters")}
      onReset={() => setDateError(false)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const from = String(form.get("from") ?? "");
      const to = String(form.get("to") ?? "");
      if (from && to && from > to) {
        setDateError(true);
        const endDate = event.currentTarget.elements.namedItem("to");
        if (endDate instanceof HTMLInputElement) endDate.focus();
        return;
      }
      setDateError(false);
      onApply(form);
    }}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] xl:items-end">
        <label className="col-span-2 grid min-w-0 gap-1 text-sm font-semibold text-muted-strong xl:col-span-1">
          {t("booking.discoveryCity")}
          <input name="city" type="search" defaultValue={filters.city} maxLength={120} className={filterInput} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-strong">
          {t("booking.discoveryFrom")}
          <input name="from" type="date" defaultValue={filters.from} min="0001-01-01" max="9999-12-30"
            className={filterInput} onChange={() => setDateError(false)} aria-describedby="catalogue-date-zone" />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-strong">
          {t("booking.discoveryTo")}
          <input name="to" type="date" defaultValue={filters.to} min="0001-01-01" max="9999-12-30"
            className={filterInput} onChange={() => setDateError(false)} aria-invalid={dateError}
            aria-describedby={dateError ? "catalogue-date-error catalogue-date-zone" : "catalogue-date-zone"} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-strong">
          {t("booking.discoveryPrice")}
          <select name="price_type" defaultValue={filters.priceType ?? ""} className={filterInput}>
            <option value="">{t("booking.discoveryPriceAny")}</option>
            {discoveryPrices.map((price) => <option key={price} value={price}>{t(`booking.discoveryPrice.${price}`)}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-strong">
          {t("booking.discoverySort")}
          <select name="sort" defaultValue={filters.sort} className={filterInput}>
            {discoverySorts.map((sort) => <option key={sort} value={sort}>{t(`booking.discoverySort.${sort}`)}</option>)}
          </select>
        </label>
        <button type="submit" className="action-button col-span-2 min-h-11 xl:col-span-1">{t("booking.discoveryApply")}</button>
      </div>
      {dateError && <p id="catalogue-date-error" className="mt-2 text-sm text-red-700" role="alert">{t("booking.discoveryDateError")}</p>}
      <p id="catalogue-date-zone" className="mt-2 text-xs text-muted">{t("booking.discoveryDateZone")}</p>
    </form>
  );
}

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
            {/* Decorative: the link text below already names the event (WCAG H2). */}
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
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const searchForm = useRef<HTMLFormElement>(null);
  const filterForm = useRef<HTMLFormElement>(null);
  const filters = readDiscovery(params);
  const { q, page } = filters;
  useEffect(() => {
    if (focusResults.current) {
      focusResults.current = false;
      resultsHeading.current?.focus();
    }
  }, [page]);
  const category = filters.category ?? "";
  const filtered = Boolean(q || category || filters.city || filters.from || filters.to || filters.priceType || filters.sort !== "soonest");
  const apiFilters = discoveryApiFilters(filters);
  const events = useQuery({
    queryKey: ["events", "public", apiFilters],
    queryFn: ({ signal }) => eventsApi.list(apiFilters, signal),
    retry: 1,
  });
  const hasNextPage = Boolean(events.data && events.data.length > discoveryPageSize);
  const displayedEvents = events.data?.slice(0, discoveryPageSize) ?? [];
  const showHero = !filtered && page === 1;
  const featured = showHero ? displayedEvents.find((event) => event.cover_image_url) : undefined;
  const updateFilters = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    next.delete("page");
    setParams(next, { preventScrollReset: true });
  };
  const changePage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set("page", String(nextPage)); else next.delete("page");
    focusResults.current = true;
    setParams(next);
  };
  const clear = () => {
    searchForm.current?.reset();
    filterForm.current?.reset();
    setParams(clearDiscovery(params), { preventScrollReset: true });
  };
  const pageLabel = t("booking.discoveryPage", { page: new Intl.NumberFormat(locale).format(page) });

  return (
    <main className="site-container pt-5 pb-10 sm:pt-8 sm:pb-15">
      {showHero && <DiscoveryHero featured={featured} />}
      <section id="event-catalogue" className={`scroll-mt-6 ${showHero ? "mt-9 sm:mt-12" : "pt-5"}`} aria-labelledby="catalogue-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {showHero
            ? <h2 id="catalogue-heading" ref={resultsHeading} tabIndex={-1} className="page-title">{t("catalogue.upcoming")}</h2>
            : <h1 id="catalogue-heading" ref={resultsHeading} tabIndex={-1} className="page-title">
                {t(filtered ? "catalogue.results" : "catalogue.upcoming")}
              </h1>}
          {events.isSuccess && displayedEvents.length > 0 && (
            <p className="text-sm font-semibold text-muted" role="status">
              {page > 1 || hasNextPage
                ? t("booking.discoveryResultsRange", {
                    from: new Intl.NumberFormat(locale).format((page - 1) * discoveryPageSize + 1),
                    to: new Intl.NumberFormat(locale).format((page - 1) * discoveryPageSize + displayedEvents.length),
                  })
                : t("catalogue.count", { count: displayedEvents.length, formatted: new Intl.NumberFormat(locale).format(displayedEvents.length) })}
            </p>
          )}
        </div>

        <form ref={searchForm} role="search" className="mt-5 flex min-h-[54px] max-w-2xl items-center gap-2 rounded-xl border border-line bg-white p-1.5 pl-3.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25"
          onSubmit={(event) => {
            event.preventDefault();
            updateFilters({ q: new FormData(event.currentTarget).get("q")?.toString().trim() ?? "" });
          }}>
          <Search size={20} className="shrink-0 text-primary" aria-hidden="true" />
          <input key={q} type="search" name="q" defaultValue={q} maxLength={100} aria-label={t("booking.discoverySearch")}
            placeholder={t("booking.discoverySearch")} className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted focus-visible:outline-none" />
          <button type="submit" className="action-button action-button--primary min-h-10 px-3 sm:px-5">
            <span className="hidden sm:inline">{t("nav.search")}</span>
            <span className="sr-only sm:hidden">{t("nav.search")}</span>
            <ArrowUpRight size={18} className="sm:hidden" aria-hidden="true" />
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2.5" role="group" aria-label={t("organizerEvent.category")}>
          {(["", ...discoveryCategories] as const).map((value) => {
            const CategoryIcon = value ? categoryIcons[value] : CalendarDays;
            return (
              <button key={value || "all"} type="button" aria-pressed={category === value} onClick={() => updateFilters({ category: value })}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${category === value ? "border-primary bg-accent-wash text-primary" : "border-line bg-white text-muted-strong hover:border-primary hover:text-primary"}`}>
                <CategoryIcon size={16} aria-hidden="true" />{value ? t(`organizerEvent.category.${value}`) : t("catalogue.allCategories")}
              </button>
            );
          })}
          {filtered && <button type="button" onClick={clear} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-accent-wash">
            <X size={16} aria-hidden="true" />{t("catalogue.clear")}
          </button>}
        </div>
        <DiscoveryFilters key={JSON.stringify([filters.city, filters.from, filters.to, filters.priceType, filters.sort])} filters={filters} formRef={filterForm}
          onApply={(form) => updateFilters({
            city: String(form.get("city") ?? "").trim(),
            from: String(form.get("from") ?? ""),
            to: String(form.get("to") ?? ""),
            price_type: String(form.get("price_type") ?? ""),
            sort: form.get("sort") === "soonest" ? "" : String(form.get("sort") ?? ""),
          })} />

        {events.isPending ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status">
            <span className="sr-only">{t("common.loading")}</span>
            {[1, 2, 3].map((item) => <div key={item} aria-hidden="true" className="panel h-52 animate-pulse bg-soft" />)}
          </div>
        ) : events.isError || displayedEvents.length === 0 ? (
          <div role={events.isError ? "alert" : "status"} className="panel mt-6 flex flex-col items-center px-6 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent-wash text-primary">
              {filtered ? <Search size={22} aria-hidden="true" /> : <Ticket size={24} aria-hidden="true" />}
            </span>
            <h3 className="mt-4 text-lg font-bold">{t(events.isError ? "catalogue.loadError" : "catalogue.empty")}</h3>
            <p className="mt-1 max-w-md text-sm text-muted">{t(events.isError
              ? "errors.unavailable" : page > 1 ? "booking.discoveryEmptyPage" : filtered ? "booking.discoveryEmptyFilters" : "catalogue.emptyUpcoming")}</p>
            {events.isError && <button type="button" className="action-button mt-5" onClick={() => void events.refetch()}>{t("common.retry")}</button>}
            {!events.isError && filtered && <button type="button" className="action-button mt-5" onClick={clear}>{t("catalogue.clear")}</button>}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {displayedEvents.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
        {(page > 1 || hasNextPage) && (
          <nav className="mt-6 flex flex-wrap items-center justify-center gap-3" aria-label={t("booking.discoveryPagination")}>
            <button type="button" className="action-button min-h-11" disabled={page === 1} onClick={() => changePage(page - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />{t("booking.discoveryPrevious")}
            </button>
            <span className="text-sm font-semibold text-muted" aria-current="page">{pageLabel}</span>
            <button type="button" className="action-button min-h-11" disabled={!hasNextPage} onClick={() => changePage(page + 1)}>
              {t("booking.discoveryNext")}<ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        )}
      </section>
    </main>
  );
};
