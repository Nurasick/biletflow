import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber } from "antd";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { ApiError } from "../../../shared/api/auth";
import { ticketTypesApi } from "../../../shared/api/eventManagement";
import type { TicketTypeInput } from "../../../shared/api/eventManagement";
import { formatMinor } from "../../../shared/lib/formatPrice";
import { organizerEventKeys } from "../model/useEventLifecycle";

type Props = { eventId: number; userId: number; editable: boolean };

const EMPTY = { name: "", description: "", price: 0, quantity: 100, maxPerOrder: null as number | null };

// The organizer's real inventory (audit #12): what the preview, the publish
// guard and checkout all read. Hidden types stay listed here (§4.3 "hide
// ticket types without deleting them").
export const TicketTypesPanel = ({ eventId, userId, editable }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const queryKey = organizerEventKeys.ticketTypes(eventId);
  const types = useQuery({ queryKey, queryFn: () => ticketTypesApi.list(eventId) });
  const [draft, setDraft] = useState(EMPTY);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: organizerEventKeys.preview(userId, eventId) });
  };
  const create = useMutation({
    mutationFn: (input: TicketTypeInput) => ticketTypesApi.create(eventId, input),
    onSuccess: async () => { setDraft(EMPTY); await refresh(); },
  });
  const toggleHidden = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) => ticketTypesApi.update(eventId, id, { is_hidden: hidden }),
    onSuccess: refresh,
  });

  const submit = () => create.mutate({
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    // Entered in tenge, stored in tiyn.
    price_minor: Math.round(draft.price * 100),
    quantity_total: draft.quantity,
    max_per_order: draft.maxPerOrder,
    is_hidden: false,
  });
  const error = create.error ?? toggleHidden.error;

  return (
    <section aria-labelledby="ticket-types" className="rounded-xl border border-[#D0D5DD] bg-white p-5">
      <h2 id="ticket-types" className="flex items-center gap-2 font-semibold"><Ticket size={18} aria-hidden="true" />{t("ticketTypes.title")}</h2>
      <p className="mt-1 text-xs text-[#667085]">{t("ticketTypes.description")}</p>
      {types.data && types.data.length > 0 && <ul className="mt-4 divide-y divide-[#EAECF0]">
        {types.data.map((type) => <li key={type.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className={`font-semibold ${type.is_hidden ? "text-[#98A2B3] line-through" : ""}`}>{type.name}</p>
            <p className="text-xs text-[#667085]">
              {type.price_minor === 0 ? t("eventWorkflow.free") : formatMinor(type.price_minor, locale)}
              {" · "}{t("ticketTypes.sold", { sold: type.quantity_sold, total: type.quantity_total })}
              {type.max_per_order ? ` · ${t("ticketTypes.maxPerOrder", { count: type.max_per_order })}` : ""}
            </p>
          </div>
          {editable && <Button size="small" loading={toggleHidden.isPending && toggleHidden.variables?.id === type.id}
            onClick={() => toggleHidden.mutate({ id: type.id, hidden: !type.is_hidden })}>
            {t(type.is_hidden ? "ticketTypes.show" : "ticketTypes.hide")}
          </Button>}
        </li>)}
      </ul>}
      {types.data?.length === 0 && <p className="mt-4 text-sm text-[#667085]">{t("eventWorkflow.noTickets")}</p>}
      {editable && <div className="mt-5 grid gap-3 rounded-lg bg-[#F5F5F0] p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold sm:col-span-2">{t("ticketTypes.name")}
          <Input maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">{t("ticketTypes.price")}
          <InputNumber className="w-full" min={0} step={500} value={draft.price}
            onChange={(value) => setDraft({ ...draft, price: value ?? 0 })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">{t("ticketTypes.quantity")}
          <InputNumber className="w-full" min={1} value={draft.quantity}
            onChange={(value) => setDraft({ ...draft, quantity: value ?? 1 })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">{t("ticketTypes.limit")}
          <InputNumber className="w-full" min={1} value={draft.maxPerOrder}
            onChange={(value) => setDraft({ ...draft, maxPerOrder: value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold sm:col-span-2">{t("ticketTypes.descriptionLabel")}
          <Input.TextArea rows={2} value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <Button type="primary" icon={<Plus size={15} aria-hidden="true" />} className="sm:col-span-2"
          disabled={!draft.name.trim()} loading={create.isPending} onClick={submit}>{t("ticketTypes.add")}</Button>
      </div>}
      {error && <Alert role="alert" type="error" showIcon className="mt-4"
        title={error instanceof ApiError ? error.message : t("eventWorkflow.networkError")} />}
    </section>
  );
};
