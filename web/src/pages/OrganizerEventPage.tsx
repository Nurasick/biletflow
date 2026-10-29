import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";

import type { OrganizerEventValues } from "../features/Organizer/model/eventSchema";
import { useOrganizerEvent } from "../features/Organizer/model/useOrganizerEvent";
import { EventStatusBadge } from "../features/Organizer/ui/EventStatusBadge";
import { OrganizerEventForm } from "../features/Organizer/ui/OrganizerEventForm";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import type { OrganizerContext } from "../shared/auth/OrganizerRoute";

// Drafts and published events are editable; suspended and cancelled ones are
// not. The backend enforces the same rule (audit #15).
const EDITABLE = new Set(["draft", "published"]);

const OrganizerEventEditor = ({ userId, eventId }: { userId: number; eventId: number | null }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { draft, saveDraft } = useOrganizerEvent(userId, eventId);
  const event = draft.data?.event ?? null;
  const previewHref = eventId ? `/organizer/events/${eventId}/preview` : undefined;

  const save = async (values: OrganizerEventValues) => {
    const result = await saveDraft.mutateAsync(values);
    // A new draft now has an id: continue editing it at its own URL. Deferred
    // so the form has reset first and the unsaved-changes guard lets it go.
    if (eventId === null) setTimeout(() => navigate(`/organizer/events/${result.id}/edit`, { replace: true }), 0);
    return result.values;
  };

  return (
    <OrganizerWorkspace>
      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">{t("organizerEvent.eyebrow")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t(eventId ? "organizerEvent.editTitle" : "nav.createEvent")}</h1>
        {event && <EventStatusBadge status={event.status} />}
      </div>
      <p className="mt-2 mb-6 text-sm leading-6 text-[#667085]">{t("organizerEvent.pageDescription")}</p>
      {event?.status === "published" && <Alert type="info" showIcon className="mb-6" title={t("eventEdit.publishedHint")} />}
      {draft.isPending ? (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white py-20 text-sm text-[#667085]">
          <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} aria-hidden="true" />{t("organizerEvent.loading")}
        </div>
      ) : draft.isError ? (
        <Alert role="alert" type="error" showIcon title={t(draft.error.message === "organizerEvent.accessError"
          ? "eventWorkflow.notFound" : "organizerEvent.loadError")}
          action={<Button onClick={() => void draft.refetch()} loading={draft.isFetching}>{t("common.retry")}</Button>} />
      ) : event && !EDITABLE.has(event.status) ? (
        <div className="rounded-xl border border-[#D0D5DD] bg-white p-6">
          <p className="text-sm leading-6 text-[#667085]">{t("eventWorkflow.readOnly")}</p>
          <Link to={previewHref!} className="mt-4 inline-block font-semibold text-[#A93216]">{t("eventWorkflow.preview")}</Link>
        </div>
      ) : (
        <OrganizerEventForm key={eventId ?? "new"} draft={draft.data.values} saveDraft={save} previewHref={previewHref} editing={eventId !== null} />
      )}
      <p className="mt-6 text-xs text-[#667085]">{t("organizer.required")}</p>
    </OrganizerWorkspace>
  );
};

export const OrganizerEventPage = () => {
  const { t } = useTranslation();
  const { userId } = useOutletContext<OrganizerContext>();
  const { eventId: param } = useParams();
  const validId = param === undefined || (/^[1-9]\d*$/.test(param) && Number.isSafeInteger(Number(param)));
  if (!validId) return <OrganizerWorkspace>
    <Alert role="alert" type="error" title={t("eventWorkflow.notFound")} />
    <Link to="/organizer/events" className="mt-4 inline-block font-semibold text-[#A93216]">{t("eventWorkflow.myEvents")}</Link>
  </OrganizerWorkspace>;
  const eventId = param === undefined ? null : Number(param);
  return <OrganizerEventEditor key={`${userId}:${eventId ?? "new"}`} userId={userId} eventId={eventId} />;
};
