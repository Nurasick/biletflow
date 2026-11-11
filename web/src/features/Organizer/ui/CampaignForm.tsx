import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Select } from "antd";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { campaignsApi } from "../../../shared/api/campaigns";
import type { Campaign, CampaignInput, CampaignUpdate, DiscountType } from "../../../shared/api/campaigns";
import type { OrganizerTicketType } from "../../../shared/api/eventLifecycle";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { parseLocalDateTime, resolveEventDateTime, toLocalDateTime } from "../model/eventDateTime";

type Props = {
  eventId: number;
  campaign: Campaign | null;
  timeZone: string;
  ticketTypes: OrganizerTicketType[];
  loadingTypes: boolean;
  retryTypes?: () => void;
  onClose: () => void;
  onSaved: (campaign: Campaign) => void;
};

type ValidationError = "campaigns.nameRequired" | "campaigns.codeFormat" | "campaigns.discountInvalid"
  | "campaigns.limitInvalid" | "campaigns.dateRange" | "validation.eventDateTime"
  | "validation.eventDateNonexistent" | "validation.eventDateAmbiguous";

const MAX_INTEGER = 2_147_483_647;
const field = "flex min-w-0 flex-col gap-1.5 text-sm font-medium";

export const CampaignForm = ({ eventId, campaign, timeZone, ticketTypes, loadingTypes, retryTypes, onClose, onSaved }: Props) => {
  const { t } = useTranslation();
  const errorMessage = useAuthErrorMessage();
  const startsAt = campaign?.starts_at ? toLocalDateTime(campaign.starts_at, timeZone) : "";
  const endsAt = campaign?.ends_at ? toLocalDateTime(campaign.ends_at, timeZone) : "";
  const [name, setName] = useState(campaign?.name ?? "");
  const [code, setCode] = useState(campaign?.code ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(campaign?.discount_type ?? "percent");
  const [value, setValue] = useState<number | null>(campaign
    ? campaign.discount_value / (campaign.discount_type === "fixed" ? 100 : 1) : null);
  const [start, setStart] = useState(startsAt);
  const [end, setEnd] = useState(endsAt);
  const [limit, setLimit] = useState<number | null>(campaign?.max_redemptions ?? null);
  const [types, setTypes] = useState(campaign?.ticket_type_ids ?? []);
  const [active, setActive] = useState(campaign?.is_active ?? true);
  const [validation, setValidation] = useState<ValidationError | null>(null);
  const submitting = useRef(false);
  const save = useMutation({
    mutationFn: (input: { create: CampaignInput } | { id: number; update: CampaignUpdate }) => "create" in input
      ? campaignsApi.create(eventId, input.create)
      : campaignsApi.update(eventId, input.id, input.update),
    onSuccess: onSaved,
    onSettled: () => { submitting.current = false; },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    save.reset();
    setValidation(null);
    const normalizedName = name.trim();
    const trimmedCode = code.trim();
    if (!normalizedName) return setValidation("campaigns.nameRequired");
    if ((trimmedCode || campaign) && !/^[A-Za-z0-9_-]{3,64}$/.test(trimmedCode)) {
      return setValidation("campaigns.codeFormat");
    }
    const normalizedCode = trimmedCode.toUpperCase();
    const discount = value === null ? 0 : discountType === "percent" ? value : Math.round(value * 100);
    if (!Number.isInteger(discount) || discount < 1 || discount > (discountType === "percent" ? 100 : MAX_INTEGER)) {
      return setValidation("campaigns.discountInvalid");
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < Math.max(1, campaign?.redemption_count ?? 0) || limit > MAX_INTEGER)) {
      return setValidation("campaigns.limitInvalid");
    }

    if ((start && parseLocalDateTime(start) === null) || (end && parseLocalDateTime(end) === null)) {
      return setValidation("validation.eventDateTime");
    }
    const startMatches = start && start !== startsAt ? resolveEventDateTime(start, timeZone) : null;
    const endMatches = end && end !== endsAt ? resolveEventDateTime(end, timeZone) : null;
    if (startMatches?.length === 0 || endMatches?.length === 0) return setValidation("validation.eventDateNonexistent");
    if (startMatches?.length === 2 || endMatches?.length === 2) return setValidation("validation.eventDateAmbiguous");
    const starts = startMatches ? new Date(startMatches[0]).toISOString() : start ? campaign?.starts_at ?? null : null;
    const ends = endMatches ? new Date(endMatches[0]).toISOString() : end ? campaign?.ends_at ?? null : null;
    if (starts && ends && Date.parse(ends) <= Date.parse(starts)) return setValidation("campaigns.dateRange");
    const ticketTypeIds = [...types].sort((a, b) => a - b);

    if (!campaign) {
      submitting.current = true;
      save.mutate({ create: {
        name: normalizedName, ...(normalizedCode && { code: normalizedCode }),
        discount_type: discountType, discount_value: discount,
        starts_at: starts, ends_at: ends, max_redemptions: limit, ticket_type_ids: ticketTypeIds,
      } });
      return;
    }
    const changes: CampaignUpdate = {
      ...(normalizedName !== campaign.name && { name: normalizedName }),
      ...(normalizedCode !== campaign.code && { code: normalizedCode }),
      ...((discountType !== campaign.discount_type || discount !== campaign.discount_value) && {
        discount_type: discountType, discount_value: discount,
      }),
      ...(starts !== campaign.starts_at && { starts_at: starts }),
      ...(ends !== campaign.ends_at && { ends_at: ends }),
      ...(limit !== campaign.max_redemptions && { max_redemptions: limit }),
      ...(ticketTypeIds.join() !== campaign.ticket_type_ids.join() && { ticket_type_ids: ticketTypeIds }),
      ...(active !== campaign.is_active && { is_active: active }),
    };
    if (Object.keys(changes).length === 0) return onClose();
    submitting.current = true;
    save.mutate({ id: campaign.id, update: changes });
  };

  const close = () => { if (!submitting.current) onClose(); };

  return <Modal open title={t(campaign ? "campaigns.edit" : "campaigns.create")} footer={null}
    onCancel={close} closable={!save.isPending} keyboard={!save.isPending} mask={{ closable: false }}>
    <form className="mt-4" onSubmit={submit}>
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={`${field} sm:col-span-2`}>{t("campaigns.name")}
          <Input autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={`${field} sm:col-span-2`}>{t("promo.code")}
          <Input autoComplete="off" maxLength={64} required={Boolean(campaign)} value={code}
            placeholder={campaign ? undefined : t("campaigns.autoCode")} onChange={(e) => setCode(e.target.value)} />
        </label>
        <div className={field}>
          <span id="campaign-discount-type">{t("campaigns.discountType")}</span>
          <Select<DiscountType> value={discountType} aria-labelledby="campaign-discount-type" disabled={save.isPending}
            onChange={(type) => { setDiscountType(type); setValue(null); }}
            options={[{ value: "percent", label: t("campaigns.percent") }, { value: "fixed", label: t("campaigns.fixed") }]} />
        </div>
        <label className={field}>{t(discountType === "percent" ? "campaigns.percentValue" : "campaigns.fixedValue")}
          <InputNumber className="w-full" value={value}
            min={discountType === "percent" ? 1 : 0.01} max={discountType === "percent" ? 100 : MAX_INTEGER / 100}
            precision={discountType === "percent" ? 0 : 2} step={discountType === "percent" ? 1 : 0.01} onChange={setValue} />
        </label>
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <p className="text-xs text-[#667085] sm:col-span-2">{t("campaigns.timeZone", { zone: timeZone })}</p>
          <label className={field}>{t("organizerEvent.startsAt")}
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className={field}>{t("organizerEvent.endsAt")}
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className={`${field} sm:col-span-2`}>{t("campaigns.limit")}
          <InputNumber className="w-full" min={1} max={MAX_INTEGER} precision={0} value={limit}
            placeholder={t("campaigns.unlimited")} onChange={setLimit} />
        </label>
        <div className={`${field} sm:col-span-2`}>
          <span id="campaign-ticket-types">{t("campaigns.ticketTypes")}</span>
          <Select<number[]> mode="multiple" aria-labelledby="campaign-ticket-types" value={types} maxCount={50}
            placeholder={t("campaigns.allTypes")} loading={loadingTypes}
            disabled={save.isPending || loadingTypes || Boolean(retryTypes)} onChange={setTypes}
            options={ticketTypes.map((type) => ({ value: type.id, label: type.name }))} />
          {retryTypes && <Alert role="alert" type="warning" showIcon title={t("campaigns.typesLoadError")}
            action={<Button size="small" disabled={save.isPending} loading={loadingTypes} onClick={retryTypes}>
              {t("common.retry")}
            </Button>} />}
        </div>
        {campaign && <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} className="sm:col-span-2">
          {t("campaigns.enabled")}
        </Checkbox>}
      </fieldset>
      {(validation || save.isError) && <Alert role="alert" type="error" showIcon className="mt-4"
        title={validation ? t(validation) : errorMessage(save.error, t("campaigns.saveError"))} />}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button disabled={save.isPending} onClick={close}>{t("ops.close")}</Button>
        <Button type="primary" htmlType="submit" loading={save.isPending}>{t(campaign ? "organizer.save" : "campaigns.create")}</Button>
      </div>
    </form>
  </Modal>;
};
