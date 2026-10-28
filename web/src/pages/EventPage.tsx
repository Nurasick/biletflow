import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { CheckoutPanel } from "../features/Event/ui/CheckoutPanel/CheckoutPanel";
import { EventDetails } from "../features/Event/ui/EventInfo/EventDetails";
import { eventsApi } from "../shared/api/events";
import { ApiError } from "../shared/api/auth";

// /events/:slug: one real event (audit #2, #3). Cancelled and suspended events
// still render, with their notice and without a way to buy (§4.16).
export const EventPage = () => {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const event = useQuery({ queryKey: ["events", "detail", slug], queryFn: () => eventsApi.get(slug), retry: false });
  const types = useQuery({
    queryKey: ["events", "ticket-types", slug],
    queryFn: () => eventsApi.ticketTypes(slug),
    enabled: event.isSuccess,
  });

  if (event.isPending) return <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-[#667085]">
    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("eventWorkflow.loading")}
  </div>;
  if (event.isError) {
    const missing = event.error instanceof ApiError && event.error.status === 404;
    return <main className="mx-auto max-w-3xl px-7 py-16 text-center">
      <h1 className="text-2xl font-bold">{t(missing ? "eventWorkflow.notFound" : "errors.unavailable")}</h1>
      <Link to="/" className="mt-6 inline-block font-semibold text-[#D9431F]">{t("common.backToEvents")}</Link>
    </main>;
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-7 px-7 py-6 lg:flex-row">
      <div className="min-w-0 flex-[1.6]"><EventDetails event={event.data} /></div>
      <CheckoutPanel event={event.data} ticketTypes={types.data ?? []} loading={types.isPending} />
    </main>
  );
};
