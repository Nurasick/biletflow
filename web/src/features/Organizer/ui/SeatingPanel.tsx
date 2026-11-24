import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { Armchair } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { seatCategoryMap, seatingApi, ticketTypesApi } from "../../../shared/api/eventManagement";
import type { OrganizerEventRecord } from "../../../shared/api/organizerEvents";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { organizerEventKeys } from "../model/useEventLifecycle";
import { eventInputClass } from "./EventFormField";
import { ReportError, ReportLoading } from "./ReportControls";

type Props = { event: OrganizerEventRecord; userId: number; editable: boolean };

// §4.3.1: an assigned-seating event sells seats of a predefined venue layout.
// Each of the layout's price categories is sold as one of the event's ticket types.
export const SeatingPanel = ({ event, userId, editable }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const errorMessage = useAuthErrorMessage();
  const client = useQueryClient();
  const seatsKey = ["organizer", "seats", event.id] as const;
  const venues = useQuery({ queryKey: ["venues"], queryFn: ({ signal }) => seatingApi.venues(signal), staleTime: 5 * 60_000, retry: false });
  const seats = useQuery({ queryKey: seatsKey, queryFn: ({ signal }) => seatingApi.seats(event.id, signal), retry: false });
  const types = useQuery({
    queryKey: organizerEventKeys.ticketTypes(event.id), queryFn: ({ signal }) => ticketTypesApi.list(event.id, signal), retry: false,
  });
  // A draft of the organizer's choice; null means "as saved on the server".
  const [draft, setDraft] = useState<{ venueId: number | null; map: Record<string, number> } | null>(null);
  const configure = useMutation({
    mutationFn: ({ venueId, map }: { venueId: number; map: Record<string, number> }) =>
      seatingApi.configure(event.id, { venue_id: venueId, category_ticket_type_map: map }),
    onSuccess: (map) => {
      client.setQueryData(seatsKey, map);
      setDraft(null);
      void client.invalidateQueries({ queryKey: organizerEventKeys.preview(userId, event.id) });
      void client.invalidateQueries({ queryKey: ["organizer", "timeline", userId, event.id] });
    },
  });
  const number = new Intl.NumberFormat(locale);

  if (venues.isPending || seats.isPending || types.isPending) {
    return <Section><ReportLoading /></Section>;
  }
  const failed = [venues, seats, types].find((query) => query.isError);
  if (failed || !venues.data || !seats.data || !types.data) {
    return <Section><ReportError error={failed?.error} fetching={venues.isFetching || seats.isFetching || types.isFetching}
      retry={() => { void venues.refetch(); void seats.refetch(); void types.refetch(); }} /></Section>;
  }

  const venueId = draft ? draft.venueId : seats.data.venue_id;
  const map = draft ? draft.map : seatCategoryMap(seats.data);
  const venue = venues.data.find((item) => item.id === venueId);
  const categories = venue?.price_categories ?? [];
  const complete = venue !== undefined && categories.length > 0 && categories.every((category) => map[category] !== undefined);
  const { counts } = seats.data;

  return <Section>
    <p className="mt-2 text-xs leading-5 text-muted">{t("eventWorkflow.seatingDescription")}</p>
    {seats.data.venue_id !== null && <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-paper p-3 text-xs sm:grid-cols-6">
      {([
        ["eventWorkflow.seatsTotal", counts.total], ["eventWorkflow.seatsSellable", counts.sellable],
        ["ticketTypes.available", counts.available], ["ticketTypes.reserved", counts.held],
        ["ticketTypes.soldCount", counts.sold], ["eventWorkflow.seatsUnavailable", counts.unavailable],
      ] as const).map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-muted">{t(label)}</dt><dd className="font-semibold tabular-nums">{number.format(value)}</dd>
      </div>)}
    </dl>}
    {editable ? <form className="mt-4 space-y-4" onSubmit={(submit) => {
      submit.preventDefault();
      if (venue && complete) configure.mutate({ venueId: venue.id, map: Object.fromEntries(categories.map((c) => [c, map[c]])) });
    }}>
      <label className="block text-xs font-semibold" htmlFor={`seating-venue-${event.id}`}>
        {t("organizerEvent.venueLayout")}
        <select id={`seating-venue-${event.id}`} className={`mt-1.5 ${eventInputClass}`} value={venueId ?? ""}
          onChange={(change) => { configure.reset(); setDraft({ venueId: change.target.value ? Number(change.target.value) : null, map: {} }); }}>
          <option value="">{t("organizerEvent.venueLayoutPick")}</option>
          {venues.data.map((item) => <option key={item.id} value={item.id}>
            {t("organizerEvent.venueLayoutOption", { name: item.name, city: item.city, seats: item.total_seats })}
          </option>)}
        </select>
      </label>
      {venue && <fieldset className="min-w-0 space-y-3">
        <legend className="text-xs font-semibold">{t("eventWorkflow.seatingCategories")}</legend>
        {types.data.length === 0 && <p className="text-xs text-muted">{t("eventWorkflow.seatingNeedsTypes")}</p>}
        {categories.map((category) => <label key={category} className="grid items-center gap-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <span className="font-semibold">{category}</span>
          <select className={eventInputClass} value={map[category] ?? ""} disabled={types.data.length === 0}
            aria-label={t("eventWorkflow.seatingCategoryType", { category })}
            onChange={(change) => {
              configure.reset();
              const next = { ...map };
              if (change.target.value) next[category] = Number(change.target.value); else delete next[category];
              setDraft({ venueId, map: next });
            }}>
            <option value="">{t("eventWorkflow.seatingPickType")}</option>
            {types.data.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>)}
        <p className="text-xs text-muted">{t("eventWorkflow.seatingAccessible", { count: venue.accessible_seats })}</p>
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        <Button htmlType="submit" type="primary" disabled={!complete || !draft} loading={configure.isPending}>
          {t("eventWorkflow.seatingSave")}
        </Button>
        {draft && <Button htmlType="button" disabled={configure.isPending} onClick={() => { configure.reset(); setDraft(null); }}>
          {t("organizer.discard")}
        </Button>}
      </div>
    </form> : seats.data.venue_id !== null && <p className="mt-3 text-sm">{seats.data.venue_name}</p>}
    {configure.isSuccess && <Alert role="status" type="success" showIcon className="mt-3" title={t("eventWorkflow.seatingSaved")} />}
    {configure.isError && <Alert role="alert" type="error" showIcon className="mt-3"
      title={errorMessage(configure.error, t("eventWorkflow.seatingError"))} />}
  </Section>;
};

const Section = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  return <section id="event-seating" aria-labelledby="event-seating-title" className="scroll-mt-6 rounded-xl border border-line bg-white p-5">
    <h2 id="event-seating-title" className="flex items-center gap-2 font-semibold">
      <Armchair size={18} aria-hidden="true" />{t("eventWorkflow.seatingTitle")}
    </h2>
    {children}
  </section>;
};
