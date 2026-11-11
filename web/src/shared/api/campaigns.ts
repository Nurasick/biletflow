import { api, rawRequest } from "./auth";

export type DiscountType = "percent" | "fixed";

export type CampaignInput = {
  name: string;
  code?: string;
  discount_type: DiscountType;
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  ticket_type_ids: number[];
};

export type CampaignUpdate = Partial<CampaignInput> & { is_active?: boolean };

export type CampaignStats = {
  redemptions: number;
  orders: number;
  tickets_sold: number;
  gross_minor: number;
  discount_minor: number;
  refunds_minor: number;
  net_minor: number;
};

export type Campaign = CampaignInput & {
  id: number;
  code: string;
  is_active: boolean;
  redemption_count: number;
  link: string;
  stats: CampaignStats;
};

export type PromoSource = { kind: "code" | "token"; value: string };
export type BasketLine = { ticket_type_id: number; quantity: number };

export type PromoQuote = {
  code: string;
  name: string;
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
};

const campaignPath = (eventId: number) => `/organizer/events/${eventId}/campaigns`;

export const campaignsApi = {
  list: (eventId: number, signal?: AbortSignal) =>
    api.get<Campaign[]>(campaignPath(eventId), { signal }),
  create: (eventId: number, input: CampaignInput) =>
    api.post<Campaign>(campaignPath(eventId), input),
  update: (eventId: number, campaignId: number, input: CampaignUpdate) =>
    api.patch<Campaign>(`${campaignPath(eventId)}/${campaignId}`, input),
  qr: (eventId: number, campaignId: number) =>
    api.file(`${campaignPath(eventId)}/${campaignId}/qr.svg`, "image/svg+xml"),
  quote: (slug: string, source: PromoSource, items: BasketLine[], signal?: AbortSignal) =>
    rawRequest<PromoQuote>(`/events/${encodeURIComponent(slug)}/promo`, {
      ...api.json("POST", { [source.kind]: source.value, items }),
      signal,
    }),
};
