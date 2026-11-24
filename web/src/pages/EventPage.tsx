import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { ArrowLeft, LoaderCircle, Ticket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { CheckoutPanel } from "../features/Event/ui/CheckoutPanel/CheckoutPanel";
import { EventDetails } from "../features/Event/ui/EventInfo/EventDetails";
import { PrivateEventAccess, type UnlockStatus } from "../features/Event/ui/PrivateEventAccess";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../shared/api/auth";
import { eventAccessApi, saveEventAccess, storedEventAccess, type EventAccessInput } from "../shared/api/eventAccess";
import { eventsApi } from "../shared/api/events";
import { trackCampaignVisit } from "../shared/lib/analytics";
import { randomId } from "../shared/lib/randomId";

const credentialParams = ["invite", "access_token", "access_code"] as const;

const privateAccessError = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && error.details?.code === "private_event_access_required" ? error : null;

function EventBySlug({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [{ accessToken, accessRevision }, setAccess] = useState(() => {
    const accessToken = storedEventAccess(slug);
    return { accessToken, accessRevision: accessToken ? randomId() : null };
  });
  const [unlockStatus, setUnlockStatus] = useState<UnlockStatus>("idle");
  const exchangeInFlight = useRef(false);
  const fromLink = credentialParams.some((key) => params.has(key));
  const campaignToken = params.get("c");

  const unlock = useCallback(async (credentials: EventAccessInput) => {
    if (exchangeInFlight.current) return;
    const validLength = "access_code" in credentials
      ? credentials.access_code.length > 0 && credentials.access_code.length <= 64
      : credentials.invite_token.length > 0 && credentials.invite_token.length <= 512;
    if (!validLength) {
      setUnlockStatus("invalid");
      return;
    }

    exchangeInFlight.current = true;
    setUnlockStatus("pending");
    try {
      const access = await eventAccessApi.unlock(slug, credentials);
      saveEventAccess(slug, access.access_token);
      setAccess({ accessToken: access.access_token, accessRevision: randomId() });
      setUnlockStatus("idle");
    } catch (error) {
      setUnlockStatus(error instanceof ApiError && [403, 422].includes(error.status) ? "invalid" : "error");
    } finally {
      exchangeInFlight.current = false;
    }
  }, [slug]);

  useEffect(() => {
    if (!fromLink) return;
    let active = true;
    // Consume credentials only after the route effect survives cleanup.
    queueMicrotask(() => {
      if (!active) return;
      const cleaned = new URLSearchParams(params);
      credentialParams.forEach((key) => cleaned.delete(key));
      const invite = params.get("invite") || params.get("access_token");
      const code = params.get("access_code");
      if (invite) void unlock({ invite_token: invite });
      else if (code) void unlock({ access_code: code });
      setParams(cleaned, { replace: true, preventScrollReset: true });
    });
    return () => { active = false; };
  }, [fromLink, params, setParams, unlock]);

  const canLoad = !me.isPending && !fromLink && unlockStatus !== "pending";
  const accessScope = [slug, me.data?.id ?? null, accessRevision] as const;
  const event = useQuery({
    queryKey: ["events", "detail", ...accessScope],
    queryFn: ({ signal }) => eventsApi.get(slug, accessToken, signal),
    enabled: canLoad,
    retry: false,
    gcTime: accessToken ? 0 : undefined,
  });
  const types = useQuery({
    queryKey: ["events", "ticket-types", ...accessScope],
    queryFn: ({ signal }) => eventsApi.ticketTypes(slug, accessToken, signal),
    enabled: canLoad && event.isSuccess,
    retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status < 500),
    gcTime: accessToken ? 0 : undefined,
  });

  const detailDenied = privateAccessError(event.error);
  const typesDenied = privateAccessError(types.error);
  const accessDenied = detailDenied ?? typesDenied;
  useEffect(() => {
    if (canLoad && event.isSuccess && !accessDenied && campaignToken) trackCampaignVisit(event.data.id, campaignToken);
  }, [accessDenied, campaignToken, canLoad, event.data, event.isSuccess]);

  if (!fromLink && accessDenied) {
    return <PrivateEventAccess canUseCode={accessDenied.details?.has_access_code !== false}
      status={unlockStatus} onUnlock={(credentials) => void unlock(credentials)} />;
  }

  if (!canLoad || event.isPending) return <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("common.loading")}
  </div>;
  if (event.isError) {
    const missing = event.error instanceof ApiError && event.error.status === 404;
    return <main className="mx-auto max-w-3xl px-7 py-16 text-center">
      <h1 className="page-title">{t(missing ? "eventWorkflow.notFound" : "errors.unavailable")}</h1>
      <Link to="/" className="mt-6 inline-block font-semibold text-primary-hover">{t("common.backToEvents")}</Link>
    </main>;
  }

  return (
    <main className="site-container py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-semibold text-muted-strong hover:text-primary">
          <ArrowLeft size={17} aria-hidden="true" />{t("common.backToEvents")}
        </Link>
        {event.data.status === "published" && event.data.phase !== "completed" && (
          <a href="#ticket-booking" className="action-button action-button--primary min-h-10 lg:hidden">
            <Ticket size={16} aria-hidden="true" />{t("booking.selectTickets")}
          </a>
        )}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,390px)] lg:gap-8">
        <EventDetails event={event.data} accessToken={accessToken} />
        {types.isError && !types.data ? <aside id="ticket-booking" tabIndex={-1} className="scroll-mt-6">
          <Alert role="alert" type="error" showIcon title={t("checkout.ticketLoadError")}
            action={<Button onClick={() => void types.refetch()} loading={types.isFetching}>{t("common.retry")}</Button>} />
        </aside> : <CheckoutPanel event={event.data} ticketTypes={types.data ?? []} loading={types.isPending}
          accessToken={accessToken} accessRevision={accessRevision} />}
      </div>
    </main>
  );
}

export const EventPage = () => {
  const { slug = "" } = useParams();
  return <EventBySlug key={slug} slug={slug} />;
};
