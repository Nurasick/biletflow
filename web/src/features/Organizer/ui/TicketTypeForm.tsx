import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, Modal } from "antd";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../../../shared/api/auth";
import type { OrganizerTicketType } from "../../../shared/api/eventLifecycle";
import { ticketTypesApi } from "../../../shared/api/eventManagement";
import type { TicketTypeInput } from "../../../shared/api/eventManagement";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { ticketTypeChanges, ticketTypeDraft, ticketTypeInput } from "../model/ticketTypeForm";
import type { TicketTypeDraft } from "../model/ticketTypeForm";
import { eventInputClass } from "./EventFormField";

type ValidationFailure = Extract<ReturnType<typeof ticketTypeInput>, { field: keyof TicketTypeDraft }>;
const labelClass = "flex min-w-0 flex-col gap-1.5 text-sm font-semibold";

type Props = {
  eventId: number;
  timeZone: string;
  ticket?: OrganizerTicketType;
  committed: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onConflict: () => void;
};

export const TicketTypeForm = ({ eventId, timeZone, ticket, committed, onClose, onSaved, onConflict }: Props) => {
  const { t } = useTranslation();
  const id = useId();
  const errorMessage = useAuthErrorMessage();
  const [draft, setDraft] = useState(() => ticketTypeDraft(timeZone, ticket));
  const [validation, setValidation] = useState<ValidationFailure>();
  const submitting = useRef(false);
  const save = useMutation({
    mutationFn: (action: { create: TicketTypeInput } | { id: number; changes: Partial<TicketTypeInput> }) =>
      "create" in action ? ticketTypesApi.create(eventId, action.create)
        : ticketTypesApi.update(eventId, action.id, action.changes),
    onSuccess: async () => { await onSaved(); onClose(); },
    onError: (error) => { if (error instanceof ApiError && error.status === 409) onConflict(); },
    onSettled: () => { submitting.current = false; },
  });
  const title = t(ticket ? "ticketTypes.edit" : "ticketTypes.add");
  const action = t(ticket ? "organizer.save" : "ticketTypes.add");
  const close = () => { if (!submitting.current) onClose(); };
  const update = <Key extends keyof TicketTypeDraft,>(key: Key, value: TicketTypeDraft[Key]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (validation?.field === key) setValidation(undefined);
  };
  const fieldError = (key: keyof TicketTypeDraft) => ({
    "aria-invalid": validation?.field === key,
    "aria-describedby": validation?.field === key ? `${id}-error` : undefined,
  });
  const quantityHint = committed > 0 ? `${id}-committed` : undefined;

  return <Modal open title={title} footer={null} onCancel={close}
    closable={!save.isPending} keyboard={!save.isPending} mask={{ closable: false }}>
    <form className="mt-4 space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current) return;
      save.reset();
      const fields = new FormData(event.currentTarget);
      const result = ticketTypeInput({
        ...draft, starts: String(fields.get("starts") ?? ""), ends: String(fields.get("ends") ?? ""),
      }, timeZone, committed, ticket);
      if (result.error) { setValidation(result); return; }
      setValidation(undefined);
      const changes = ticket && ticketTypeChanges(result.input, ticket);
      if (changes && !Object.keys(changes).length) { close(); return; }
      submitting.current = true;
      save.mutate(ticket && changes ? { id: ticket.id, changes } : { create: result.input });
    }}>
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>{t("ticketTypes.name")}
          <Input autoFocus required maxLength={200} value={draft.name}
            onChange={(event) => update("name", event.target.value)} {...fieldError("name")} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>{t("ticketTypes.descriptionLabel")}
          <Input.TextArea rows={2} value={draft.description} onChange={(event) => update("description", event.target.value)} />
        </label>
        <label className={labelClass}>{t("ticketTypes.price")}
          <Input inputMode="decimal" required value={draft.price}
            onChange={(event) => update("price", event.target.value)} {...fieldError("price")} />
        </label>
        <div className={labelClass}>
          <label htmlFor={`${id}-quantity`}>{t("ticketTypes.quantity")}</label>
          <Input id={`${id}-quantity`} inputMode="numeric" required value={draft.quantity}
            onChange={(event) => update("quantity", event.target.value)} {...fieldError("quantity")}
            aria-describedby={fieldError("quantity")["aria-describedby"] ?? quantityHint} />
          {quantityHint && <span id={quantityHint} className="text-xs font-normal text-[#667085]">
            {t("ticketTypes.committed", { tickets: committed })}
          </span>}
        </div>
        <label className={labelClass}>{t("ticketTypes.limit")}
          <Input inputMode="numeric" value={draft.maxPerOrder}
            onChange={(event) => update("maxPerOrder", event.target.value)} {...fieldError("maxPerOrder")} />
        </label>
        <div className={labelClass}>
          <label htmlFor={`${id}-position`}>{t("ticketTypes.position")}</label>
          <Input id={`${id}-position`} inputMode="numeric" required value={draft.position}
            onChange={(event) => update("position", event.target.value)} {...fieldError("position")}
            aria-describedby={fieldError("position")["aria-describedby"] ?? `${id}-position-hint`} />
          <span id={`${id}-position-hint`} className="text-xs font-normal text-[#667085]">{t("ticketTypes.positionHint")}</span>
        </div>
        <div className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-2">
          <p className="text-xs text-[#667085] sm:col-span-2">{t("ticketTypes.salesZone", { zone: timeZone })}</p>
          <label className={labelClass}>{t("ticketTypes.salesStart")}
            <input type="datetime-local" name="starts" step={60} defaultValue={draft.starts} className={eventInputClass}
              onInput={() => { if (validation?.field === "starts") setValidation(undefined); }} {...fieldError("starts")} />
          </label>
          <label className={labelClass}>{t("ticketTypes.salesEnd")}
            <input type="datetime-local" name="ends" step={60} defaultValue={draft.ends} className={eventInputClass}
              onInput={() => { if (validation?.field === "ends") setValidation(undefined); }} {...fieldError("ends")} />
          </label>
        </div>
        <Checkbox checked={draft.hidden} onChange={(event) => update("hidden", event.target.checked)}>
          {t("ticketTypes.hidden")}
        </Checkbox>
      </fieldset>
      {validation && <div id={`${id}-error`}><Alert role="alert" type="error" showIcon
        title={t(validation.error, { tickets: committed })} /></div>}
      {save.isError && <Alert role="alert" type="error" showIcon title={errorMessage(save.error, t("ticketTypes.saveError"))} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={save.isPending} onClick={close}>{t("ops.close")}</Button>
        <Button type="primary" htmlType="submit" aria-label={action} loading={save.isPending}>{action}</Button>
      </div>
    </form>
  </Modal>;
};
