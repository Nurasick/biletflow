type GoogleTag = (...command: unknown[]) => void;
type AnalyticsParameters = Record<string, string | number>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GoogleTag;
  }
}

const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim();
const enabled = typeof measurementId === "string" && /^G-[A-Z0-9]+$/.test(measurementId);
const reportedVisits = new Set<string>();
let initialized = false;

function getTag() {
  if (!enabled || !measurementId) return;
  if (!initialized) {
    initialized = true;
    const dataLayer = window.dataLayer ??= [];
    const tag: GoogleTag = function () { dataLayer.push(arguments); };
    window.gtag = tag;

    tag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    tag("js", new Date());
    tag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // SPA URLs may contain guest-order or invite tokens.
      page_location: new URL("/events", location.origin).href,
      page_referrer: new URL("/", location.origin).href,
      page_title: "BiletFlow",
    });

    const script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
  }
  return window.gtag;
}

function send(name: "campaign_visit" | "checkout_start", eventId: number, parameters: AnalyticsParameters = {}) {
  getTag()?.("event", name, { biletflow_event_id: eventId, ...parameters });
}

async function fingerprint(token?: string | null): Promise<string | undefined> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  try {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // Tracking cannot affect checkout when Web Crypto is unavailable.
    return;
  }
}

export function trackCampaignVisit(eventId: number, campaignToken?: string | null) {
  if (!enabled) return;
  void fingerprint(campaignToken).then((campaignId) => {
    if (!campaignId) return;
    const key = `${eventId}:${campaignId}`;
    if (reportedVisits.has(key)) return;
    reportedVisits.add(key);
    send("campaign_visit", eventId, { campaign_id: campaignId });
  });
}

export function trackCheckoutStart(eventId: number, campaignToken?: string | null) {
  if (!enabled) return;
  void fingerprint(campaignToken).then((campaignId) => {
    send("checkout_start", eventId, campaignId ? { campaign_id: campaignId } : {});
  });
}
