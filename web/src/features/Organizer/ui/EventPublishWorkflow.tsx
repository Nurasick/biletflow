import { Alert, Button, Modal } from "antd";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import { EventWorkflowError } from "../../../shared/api/eventLifecycle";
import type { EventAction } from "../../../shared/api/eventLifecycle";
import { useEventLifecycle } from "../model/useEventLifecycle";
import { ActivationPanel } from "./ActivationPanel";
import { AttendeesPanel } from "./AttendeesPanel";
import { EventPreviewContent } from "./EventPreviewContent";
import { EventSalesPanel } from "./EventSalesPanel";
import { StaffPanel } from "./StaffPanel";
import { TicketTypesPanel } from "./TicketTypesPanel";
import { EventStatusBadge } from "./EventStatusBadge";
import { EventTimelinePanel } from "./EventTimelinePanel";

export const EventPublishWorkflow = ({ eventId, userId }: { eventId: number; userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { preview, transition } = useEventLifecycle(userId, eventId);
  const snapshot = preview.data;
  const [confirmationState, setConfirmationState] = useState<{
    action: Exclude<EventAction, "publish">; version: string;
  } | null>(null);
  const confirmation = confirmationState && confirmationState.version === snapshot?.event.updated_at
    ? confirmationState.action : null;
  const setConfirmation = (action: Exclude<EventAction, "publish"> | null) => {
    setConfirmationState(action && snapshot ? { action, version: snapshot.event.updated_at } : null);
  };

  const perform = (action: EventAction) => {
    if (transition.isPending || preview.isFetching || preview.isError || !snapshot?.allowed_actions.includes(action)) return;
    transition.mutate(action, { onSuccess: () => setConfirmation(null) });
  };

  if (preview.isPending) return <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-[#667085]">
    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t("eventWorkflow.loading")}
  </div>;

  if (!snapshot) return <Alert role="alert" type="error" showIcon
    title={t(preview.error instanceof EventWorkflowError && preview.error.code === "notFound" ? "eventWorkflow.notFound" : "eventWorkflow.loadError")}
    action={<Button onClick={() => void preview.refetch()} loading={preview.isFetching}>{t("common.retry")}</Button>} />;

  const { event, publish_requirements, allowed_actions } = snapshot;
  const busy = transition.isPending || preview.isFetching;
  const canAct = !busy && !preview.isError;
  const blocked = publish_requirements.some((requirement) => !requirement.met);
  const confirmedAction = transition.isSuccess && transition.data.event.status === event.status
    && transition.data.event.updated_at === event.updated_at;
  const actionError = transition.isError && <Alert role="alert" type="error" showIcon className="mt-4"
    title={t("eventWorkflow.actionError")}
    description={transition.error instanceof EventWorkflowError
      ? transition.error.detail ?? t(`eventWorkflow.error.${transition.error.code}`) : t("eventWorkflow.networkError")} />;

  return <>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">{t("organizer.workspace")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{t("eventWorkflow.preview")}</h1>
          <span aria-live="polite"><EventStatusBadge status={event.status} /></span>
        </div>
      </div>
      <Button icon={<RefreshCw size={15} aria-hidden="true" />} loading={preview.isFetching}
        disabled={transition.isPending} onClick={() => { transition.reset(); void preview.refetch(); }}>
        {t("eventWorkflow.refresh")}
      </Button>
    </div>
    {(snapshot.event.status === "draft" || snapshot.event.status === "published") && <Link to={`/organizer/events/${eventId}/edit`}
      className="mt-4 inline-block text-sm font-semibold text-[#A93216]">
      {t("eventWorkflow.editDetails")}
    </Link>}
    <p className="mt-3 text-sm leading-6 text-[#667085]">{t("eventWorkflow.previewDescription")}</p>
    {!preview.isError && <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-[#A93216]">
      <a href="#event-attendees" className="rounded focus-visible:outline-2 focus-visible:outline-offset-4">{t("reports.attendeesTitle")}</a>
      <a href="#event-timeline" className="rounded focus-visible:outline-2 focus-visible:outline-offset-4">{t("reports.timelineTitle")}</a>
    </nav>}
    <div aria-live="polite" className="my-6">
      <Alert type={event.status === "cancelled" ? "error" : event.status === "published" ? "success" : "info"} showIcon
        title={t(`eventWorkflow.state.${event.status}`)}
        description={t(event.status === "published" ? `eventWorkflow.visibility.${event.visibility}` : `eventWorkflow.stateDescription.${event.status}`)} />
      {confirmedAction && <Alert role="status" type="success" showIcon className="mt-4"
        title={t(`eventWorkflow.success.${transition.variables}`)} />}
    </div>
    {preview.isError && <Alert role="alert" type="error" showIcon className="mb-6" title={t("eventWorkflow.stale")}
      action={<Button onClick={() => void preview.refetch()} loading={preview.isFetching}>{t("common.retry")}</Button>} />}
    {!confirmation && actionError}
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]" aria-busy={transition.isPending}>
      <div className="min-w-0 space-y-6">
        <EventPreviewContent snapshot={snapshot} />
        <TicketTypesPanel eventId={eventId} userId={userId} editable={event.status === "draft" || event.status === "published"} />
        <ActivationPanel eventId={eventId} />
        <EventSalesPanel eventId={eventId} />
        {!preview.isError && <>
          <AttendeesPanel key={`attendees:${userId}:${eventId}`} eventId={eventId} userId={userId} />
          <EventTimelinePanel key={`timeline:${userId}:${eventId}`} eventId={eventId} userId={userId} />
        </>}
        <StaffPanel eventId={eventId} />
      </div>
      <section aria-labelledby="event-publishing" className="rounded-xl border border-[#D0D5DD] bg-white p-5">
        <h2 id="event-publishing" className="font-semibold">{t("eventWorkflow.publishing")}</h2>
        {event.status === "draft" && <>
          <p id="publish-requirements" className="mt-2 text-sm leading-6 text-[#667085]">
            {t(blocked ? "eventWorkflow.blocked" : "eventWorkflow.ready")}
          </p>
          <ul className="my-5 space-y-4" aria-label={t("eventWorkflow.requirements")}>
            {publish_requirements.map(({ code, met }) => <li key={code} className="flex gap-2 text-xs leading-5">
              {met ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
                : <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#A93216]" aria-hidden="true" />}
              <span><span className="font-semibold">{t(met ? "eventWorkflow.met" : "eventWorkflow.unmet")}: </span>
                {t(`eventWorkflow.requirement.${code}`)}</span>
            </li>)}
          </ul>
          <Button block type="primary" disabled={!canAct || !allowed_actions.includes("publish")}
            loading={transition.isPending && transition.variables === "publish"}
            aria-describedby="publish-requirements" onClick={() => perform("publish")}>{t("eventWorkflow.publish")}</Button>
        </>}
        {allowed_actions.includes("unpublish") && <Button block className="mt-4" disabled={!canAct}
          onClick={() => { transition.reset(); setConfirmation("unpublish"); }}>{t("eventWorkflow.unpublish")}</Button>}
        {allowed_actions.includes("cancel") && <Button block danger className="mt-3" disabled={!canAct}
          onClick={() => { transition.reset(); setConfirmation("cancel"); }}>{t("eventWorkflow.cancel")}</Button>}
        <p className="mt-4 text-xs leading-5 text-[#667085]">
          {t("eventWorkflow.updated", { date: new Intl.DateTimeFormat(locale, {
            dateStyle: "medium", timeStyle: "short", timeZone: event.timezone,
          }).format(new Date(preview.dataUpdatedAt)) })}
        </p>
      </section>
    </div>
    <Modal open={confirmation !== null} title={confirmation ? t(`eventWorkflow.confirm.${confirmation}.title`) : ""}
      okText={confirmation ? t(`eventWorkflow.${confirmation}`) : ""} cancelText={t("eventWorkflow.keepEvent")}
      okButtonProps={{ danger: true, disabled: !canAct || !confirmation || !allowed_actions.includes(confirmation) }}
      confirmLoading={transition.isPending} cancelButtonProps={{ disabled: transition.isPending }}
      closable={!transition.isPending} mask={{ closable: !transition.isPending }} keyboard={!transition.isPending}
      onCancel={() => { if (!transition.isPending) { setConfirmation(null); transition.reset(); } }}
      onOk={() => { if (confirmation) perform(confirmation); }}>
      <p className="break-words font-semibold">{event.title}</p>
      <p className="mt-3">{confirmation && t(`eventWorkflow.confirm.${confirmation}.description`)}</p>
      {actionError}
    </Modal>
  </>;
};
