import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { ArrowLeft, LoaderCircle, Ticket } from "lucide-react";
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

  if (event.isPending) return <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
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
        <EventDetails event={event.data} />
        {types.isError && !types.data ? <aside id="ticket-booking" className="scroll-mt-6">
          <Alert role="alert" type="error" showIcon title={t("checkout.ticketLoadError")}
            action={<Button onClick={() => void types.refetch()} loading={types.isFetching}>{t("common.retry")}</Button>} />
        </aside> : <CheckoutPanel key={slug} event={event.data} ticketTypes={types.data ?? []} loading={types.isPending} />}
      </div>
    </main>
  );
};
