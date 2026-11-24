import { resolveEventDateTime } from "../../Organizer/model/eventDateTime";
import type { EventFilters } from "../../../shared/api/events";

export const discoveryCategories = ["concert", "theater", "sport", "conference", "other"] as const;
export const discoverySorts = ["soonest", "newest", "title"] as const;
export const discoveryPrices = ["free", "paid"] as const;
export const discoveryPageSize = 12;

const discoveryTimeZone = "Asia/Almaty";
const filterKeys = ["q", "category", "city", "from", "to", "price_type", "sort", "page"] as const;
const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / discoveryPageSize);

const readOption = <T extends string>(value: string | null, options: readonly T[]) =>
  options.find((option) => option === value);

const readDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value <= "0000-12-31" || value >= "9999-12-31") return "";
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value) ? value : "";
};

export const readDiscovery = (params: URLSearchParams) => {
  const page = Number(params.get("page"));
  return {
    q: params.get("q")?.trim().slice(0, 100) ?? "",
    category: readOption(params.get("category"), discoveryCategories),
    city: params.get("city")?.trim().slice(0, 120) ?? "",
    from: readDate(params.get("from")),
    to: readDate(params.get("to")),
    priceType: readOption(params.get("price_type"), discoveryPrices),
    sort: readOption(params.get("sort"), discoverySorts) ?? "soonest",
    page: Number.isSafeInteger(page) && page > 0 && page < maxPage ? page : 1,
  };
};

type DiscoveryFilters = ReturnType<typeof readDiscovery>;

const dateBoundary = (date: string, nextDay = false) => {
  if (!date) return;
  const midnight = new Date(`${date}T00:00:00Z`);
  if (nextDay) midnight.setUTCDate(midnight.getUTCDate() + 1);
  const wallClock = midnight.toISOString().slice(0, 10);
  const [instant] = resolveEventDateTime(`${wallClock}T00:00`, discoveryTimeZone);
  return instant === undefined ? undefined : new Date(instant).toISOString();
};

export const discoveryApiFilters = (filters: DiscoveryFilters): EventFilters => ({
  limit: discoveryPageSize + 1,
  offset: (filters.page - 1) * discoveryPageSize,
  q: filters.q,
  category: filters.category,
  city: filters.city,
  price_type: filters.priceType,
  sort: filters.sort,
  starts_after: dateBoundary(filters.from),
  starts_before: dateBoundary(filters.to, true),
});

export const clearDiscovery = (params: URLSearchParams) => {
  const search = new URLSearchParams(params);
  filterKeys.forEach((key) => search.delete(key));
  return search;
};
