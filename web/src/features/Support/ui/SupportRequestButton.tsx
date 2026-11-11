import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { LifeBuoy } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";
import { caseCategories, requesterCaseHref, supportApi } from "../../../shared/api/support";
import type { CaseCategory, CaseInput, CaseTarget } from "../../../shared/api/support";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { OperationsError, OperationsLoading } from "../../Operations/ui/OperationsWorkspace";
import { MESSAGE_MAX_LENGTH, supportKeys } from "../model/supportModel";
import { CaseContextDetails } from "./SupportCaseContent";

type RequestProps = {
  target: CaseTarget;
  eventTitle?: string;
  label: string;
  accessibleLabel?: string;
};

export const SupportRequestButton = ({ label, accessibleLabel, ...context }: RequestProps) => {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  return <>
    <Button size="small" aria-label={accessibleLabel} icon={<LifeBuoy size={14} aria-hidden="true" />}
      onClick={(event) => setTrigger(event.currentTarget)}>{label}</Button>
    {trigger && <SupportRequestDialog {...context} onClose={() => {
      setTrigger(null);
      requestAnimationFrame(() => trigger.focus());
    }} />}
  </>;
};

const SupportRequestDialog = ({ target, eventTitle, onClose }: {
  target: CaseTarget; eventTitle?: string; onClose: () => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const client = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const { me } = useAuth();
  const [category, setCategory] = useState<CaseCategory | "">("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const submitting = useRef(false);
  const user = me.data;
  const create = useMutation({
    mutationFn: (input: CaseInput) => supportApi.open(input, Boolean(user)),
    onSuccess: (created) => {
      if (user) void client.invalidateQueries({ queryKey: supportKeys.mine(user.id) });
      navigate(requesterCaseHref(created.case_number, created.access_token), { state: { caseCreated: true } });
    },
    onSettled: () => { submitting.current = false; },
  });
  const authorized = target.audience === "attendee" || Boolean(user?.is_organizer);

  return <Modal open footer={null} title={t(target.audience === "attendee" ? "support.contactOrganizer" : "support.contactPlatform")}
    onCancel={() => { if (!submitting.current) onClose(); }}
    closable={!create.isPending} keyboard={!create.isPending} mask={{ closable: false }}>
    {me.isPending ? <OperationsLoading /> : me.isError ? <OperationsError error={me.error} retry={() => void me.refetch()} />
      : !authorized ? <Alert showIcon type="warning" title={t("support.organizerRequired")} />
        : <form className="mt-4 space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current || !category || !body.trim()) return;
          submitting.current = true;
          create.mutate({ ...target, category, body: body.trim(), ...(!user && { contact_email: email.trim() }) });
        }}>
          <CaseContextDetails context={{
            event_id: target.event_id ?? null,
            event_title: eventTitle ?? null,
            order_number: target.audience === "attendee" ? target.order_number ?? null : null,
            ticket_code: target.audience === "attendee" ? target.ticket_code ?? null : null,
          }} />
          <div>
            <label htmlFor={`${id}-category`} className="mb-1.5 block text-sm font-semibold">{t("support.categoryLabel")}</label>
            <select id={`${id}-category`} value={category} required disabled={create.isPending}
              onChange={(event) => setCategory(event.target.value as CaseCategory | "")}
              className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm">
              <option value="" disabled>{t("support.chooseCategory")}</option>
              {caseCategories.map((value) => <option key={value} value={value}>{t(`support.category.${value}`)}</option>)}
            </select>
          </div>
          {user ? <p className="break-words text-sm text-[#667085]">{t("support.replyEmail", { email: user.email })}</p> : <div>
            <label htmlFor={`${id}-email`} className="mb-1.5 block text-sm font-semibold">{t("common.email")}</label>
            <Input id={`${id}-email`} type="email" autoComplete="email" required maxLength={320} disabled={create.isPending}
              value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>}
          <div>
            <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">{t("support.message")}</label>
            <Input.TextArea id={`${id}-body`} rows={4} showCount value={body} maxLength={MESSAGE_MAX_LENGTH}
              required disabled={create.isPending} onChange={(event) => setBody(event.target.value)} />
          </div>
          {create.isError && <Alert role="alert" type="error" showIcon title={errorMessage(create.error, t("support.createError"))} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={create.isPending} onClick={onClose}>{t("ops.close")}</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}
              disabled={!category || !body.trim() || (!user && !email.trim())}>{t("support.openCase")}</Button>
          </div>
        </form>}
  </Modal>;
};
