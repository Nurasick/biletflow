import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Tag } from "antd";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import type { OrganizerTicketType } from "../../../shared/api/eventLifecycle";
import { ticketTypesApi } from "../../../shared/api/eventManagement";
import type { OrganizerEventRecord } from "../../../shared/api/organizerEvents";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { organizerEventKeys } from "../model/useEventLifecycle";
import { ReportError, ReportLoading } from "./ReportControls";
import { TicketTypeForm } from "./TicketTypeForm";

type Props = { event: OrganizerEventRecord; userId: number; editable: boolean };

export const TicketTypesPanel = ({ event, userId, editable }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const errorMessage = useAuthErrorMessage();
  const client = useQueryClient();
  const { id: eventId, slug, timezone } = event;
  const queryKey = organizerEventKeys.ticketTypes(eventId);
  const types = useQuery({
    queryKey, queryFn: ({ signal }) => ticketTypesApi.list(eventId, signal), retry: false,
  });
  const [editor, setEditor] = useState<{ ticket?: OrganizerTicketType; trigger: HTMLElement } | null>(null);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: organizerEventKeys.preview(userId, eventId) }),
      client.invalidateQueries({ queryKey: ["organizer", "activation", eventId] }),
      client.invalidateQueries({ queryKey: ["organizer", "summary", eventId] }),
      client.invalidateQueries({ queryKey: ["organizer", "timeline", userId, eventId] }),
      client.invalidateQueries({ queryKey: ["events", "ticket-types", slug] }),
    ]);
  };
  const toggleHidden = useMutation({
    mutationFn: (ticket: OrganizerTicketType) => ticketTypesApi.update(eventId, ticket.id, { is_hidden: !ticket.is_hidden }),
    onSuccess: refresh,
    onError: (error) => { if (error instanceof ApiError && error.status === 409) void types.refetch(); },
  });
  const close = () => {
    setEditor(null);
    if (editor) requestAnimationFrame(() => editor.trigger.focus());
  };
  const current = types.data?.find((type) => type.id === editor?.ticket?.id) ?? editor?.ticket;
  const committed = current ? current.quantity_sold + current.quantity_reserved : 0;

  return <section id="event-ticket-types" aria-labelledby="ticket-types-title" className="scroll-mt-6 rounded-xl border border-[#D0D5DD] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="ticket-types-title" className="flex items-center gap-2 font-semibold">
        <Ticket size={18} aria-hidden="true" />{t("ticketTypes.title")}
      </h2>
      {editable && <Button size="small" type="primary" icon={<Plus size={15} aria-hidden="true" />}
        disabled={toggleHidden.isPending} onClick={(event) => setEditor({ trigger: event.currentTarget })}>{t("ticketTypes.add")}</Button>}
    </div>
    <p className="mt-2 text-xs text-[#667085]">{t("ticketTypes.description")}</p>
    {types.isPending ? <ReportLoading /> : types.isError ? <div className="mt-3">
      <ReportError error={types.error} retry={() => void types.refetch()} fetching={types.isFetching} />
    </div> : types.data.length === 0 ? <p className="mt-4 text-sm text-[#667085]">{t("eventWorkflow.noTickets")}</p>
      : <ul className="mt-3 divide-y divide-[#EAECF0]">
        {types.data.map((type) => <li key={type.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 break-words font-semibold">{type.name}</p>
              {type.is_hidden && <Tag>{t("ticketTypes.hiddenBadge")}</Tag>}
            </div>
            <p className="mt-1 text-xs text-[#667085]">
              {type.price_minor === 0 ? t("eventWorkflow.free") : formatMinor(type.price_minor, locale)}
              {" · "}{t("ticketTypes.sold", { sold: type.quantity_sold, total: type.quantity_total })}
              {type.max_per_order ? ` · ${t("ticketTypes.maxPerOrder", { count: type.max_per_order })}` : ""}
            </p>
            {(type.sales_start_at || type.sales_end_at) && <p className="mt-1 text-xs text-[#667085]">
              {type.sales_start_at && t("ticketTypes.opensAt", { date: date.format(parseApiInstant(type.sales_start_at)) })}
              {type.sales_start_at && type.sales_end_at && " · "}
              {type.sales_end_at && t("ticketTypes.closesAt", { date: date.format(parseApiInstant(type.sales_end_at)) })}
            </p>}
          </div>
          {editable && <div className="flex flex-wrap gap-2">
            <Button size="small" disabled={toggleHidden.isPending}
              onClick={(event) => setEditor({ ticket: type, trigger: event.currentTarget })}>{t("ticketTypes.edit")}</Button>
            <Button size="small" disabled={toggleHidden.isPending}
              loading={toggleHidden.isPending && toggleHidden.variables?.id === type.id}
              onClick={() => toggleHidden.mutate(type)}>{t(type.is_hidden ? "ticketTypes.show" : "ticketTypes.hide")}</Button>
          </div>}
        </li>)}
      </ul>}
    {toggleHidden.isError && <Alert role="alert" type="error" showIcon className="mt-3"
      title={errorMessage(toggleHidden.error, t("ticketTypes.saveError"))} />}
    {editable && editor && <TicketTypeForm eventId={eventId} timeZone={timezone} ticket={editor.ticket} committed={committed}
      onClose={close} onSaved={refresh} onConflict={() => void types.refetch()} />}
  </section>;
};
