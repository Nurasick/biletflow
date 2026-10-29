import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { adminApi } from "../../../shared/api/admin";
import type { AdminActivationAction, AdminEventAction } from "../../../shared/api/admin";
import { activationModerationAction, eventModerationActions, operationsKeys } from "../model/operationsModel";
import { OperationsError, operationsCard } from "./OperationsWorkspace";

type Intent = { target: "event"; action: AdminEventAction } | { target: "activation"; action: AdminActivationAction };
const eventLabels = { suspend: "ops.suspendEvent", unsuspend: "ops.restoreEvent", cancel: "ops.cancelEvent" } as const;
const activationLabels = { suspend: "ops.suspendActivation", reinstate: "ops.reinstateActivation" } as const;
const eventConfirm = { suspend: "ops.suspendEventConfirm", unsuspend: "ops.restoreEventConfirm", cancel: "ops.cancelEventConfirm" } as const;
const activationConfirm = { suspend: "ops.suspendActivationConfirm", reinstate: "ops.reinstateActivationConfirm" } as const;
const eventDescription = { suspend: "ops.suspendEventDescription", unsuspend: "ops.restoreEventDescription", cancel: "ops.cancelEventDescription" } as const;
const activationDescription = { suspend: "ops.suspendActivationDescription", reinstate: "ops.reinstateActivationDescription" } as const;

export const AdminModeration = ({ eventId, userId, status, activationStatus, ready, activationReady }: {
  eventId: number; userId?: number; status: string; activationStatus?: string; ready: boolean; activationReady: boolean;
}) => {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState(false);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: operationsKeys.adminEvent(userId, eventId) }),
      client.invalidateQueries({ queryKey: operationsKeys.activation(userId, eventId) }),
      client.invalidateQueries({ queryKey: operationsKeys.timelines(userId, eventId) }),
      client.invalidateQueries({ queryKey: operationsKeys.adminLists(userId) }),
      client.invalidateQueries({ queryKey: operationsKeys.staffEvents(userId) }),
    ]);
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ selection, reason }: { selection: Intent; reason: string }) => {
      if (selection.target === "event") return adminApi.transition(eventId, selection.action, reason);
      return adminApi.transitionActivation(eventId, selection.action, reason);
    },
    onSuccess: () => { setIntent(null); setReason(""); setSuccess(true); },
    onSettled: refresh,
  });
  const open = (selection: Intent) => { mutation.reset(); setSuccess(false); setReason(""); setIntent(selection); };
  const needsReason = intent?.action === "suspend";
  const showsReason = needsReason || (intent?.target === "event" && intent.action === "cancel");
  const validReason = reason.trim().length <= 500 && (!needsReason || reason.trim().length > 0);
  const eventActions = eventModerationActions(status);
  const activationAction = activationModerationAction(activationStatus ?? "");
  const selectionAvailable = intent && (intent.target === "event"
    ? eventActions.includes(intent.action) : activationAction === intent.action);
  const canConfirm = ready && !mutation.isPending && selectionAvailable && validReason && (intent?.target !== "activation" || activationReady);

  return <section className={operationsCard}>
    <h2 className="text-xl font-bold">{t("ops.moderation")}</h2>
    <div className="mt-4 flex flex-wrap gap-3">
      {eventActions.map((action) => <Button key={action} danger={action === "cancel"} disabled={!ready || mutation.isPending}
        onClick={() => open({ target: "event", action })}>{t(eventLabels[action])}</Button>)}
      {activationAction && <Button disabled={!ready || !activationReady || mutation.isPending}
        onClick={() => open({ target: "activation", action: activationAction })}>{t(activationLabels[activationAction])}</Button>}
    </div>
    {eventActions.length === 0 && <p className="mt-3 text-sm text-[#667085]">{t("ops.noActions")}</p>}
    {success && <div role="status" className="mt-4"><Alert type="success" showIcon title={t("ops.saved")} /></div>}
    {mutation.isError && !intent && <div className="mt-4"><OperationsError error={mutation.error} saving /></div>}
    <Modal open={Boolean(intent)} title={intent && t(intent.target === "event" ? eventConfirm[intent.action] : activationConfirm[intent.action])}
      closable={!mutation.isPending} maskClosable={!mutation.isPending} onCancel={() => { if (!mutation.isPending) setIntent(null); }}
      okText={t("ops.confirm")} cancelText={t("ops.close")} confirmLoading={mutation.isPending}
      cancelButtonProps={{ disabled: mutation.isPending }} okButtonProps={{ disabled: !canConfirm, danger: intent?.action === "cancel" }}
      onOk={() => { if (intent && canConfirm) mutation.mutate({ selection: intent, reason: reason.trim() }); }}>
      {intent && <p className="my-4 text-sm leading-6">{t(intent.target === "event" ? eventDescription[intent.action] : activationDescription[intent.action])}</p>}
      {showsReason && <div className="mb-4 space-y-2"><label htmlFor="moderation-reason" className="block text-sm font-semibold">{t(needsReason ? "ops.reason" : "ops.reasonOptional")}</label>
        <Input.TextArea id="moderation-reason" rows={3} value={reason} maxLength={500} disabled={mutation.isPending}
          onChange={(event) => setReason(event.target.value)} aria-required={needsReason} aria-describedby={needsReason ? "moderation-reason-hint" : undefined} />
        {needsReason && <p id="moderation-reason-hint" className="text-xs text-[#667085]">{t("ops.reasonRequired")}</p>}</div>}
      {mutation.isError && <OperationsError error={mutation.error} saving />}
    </Modal>
  </section>;
};
