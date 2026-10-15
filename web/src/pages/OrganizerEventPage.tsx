import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router-dom";

import { useEventLifecycle } from "../features/Organizer/model/useEventLifecycle";
import { useOrganizerEvent } from "../features/Organizer/model/useOrganizerEvent";
import { EventStatusBadge } from "../features/Organizer/ui/EventStatusBadge";
import { OrganizerEventForm } from "../features/Organizer/ui/OrganizerEventForm";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";

export const OrganizerEventPage = () => {
  const { t } = useTranslation();
  const { userId } = useOutletContext<{ userId: number }>();
  const { draft, saveDraft } = useOrganizerEvent(userId);
  const { preview } = useEventLifecycle(userId, 1, Boolean(draft.data?.title));
  const savedDraft = Boolean(draft.data?.title);
  const loading = draft.isPending || (savedDraft && preview.isPending && !saveDraft.isPending);
  const status = preview.data?.event.status;

  return (
    <OrganizerWorkspace>
      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">{t("organizerEvent.eyebrow")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("nav.createEvent")}</h1>
        {!loading && !draft.isError && (!savedDraft || !preview.isError) && <EventStatusBadge status={status ?? "draft"} />}
      </div>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{t("organizerEvent.pageDescription")}</p>
      <p className="my-6 rounded-lg border border-[#D0D5DD] px-4 py-3 text-xs leading-5 text-[#667085]">
        <span className="font-semibold text-[#101828]">{t("organizer.demoWorkspace")}</span> {t("organizerEvent.demoDescription")}
      </p>
      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white py-20 text-sm text-[#667085]">
          <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} aria-hidden="true" />{t("organizerEvent.loading")}
        </div>
      ) : draft.isError || (savedDraft && preview.isError) ? (
        <Alert role="alert" type="error" showIcon title={t(draft.isError ? "organizerEvent.loadError" : "eventWorkflow.loadError")}
          action={<Button onClick={() => { void draft.refetch(); if (savedDraft) void preview.refetch(); }}
            loading={draft.isFetching || preview.isFetching}>{t("common.retry")}</Button>} />
      ) : status && status !== "draft" ? (
        <div className="rounded-xl border border-[#D0D5DD] bg-white p-6">
          <p className="text-sm leading-6 text-[#667085]">{t(status === "published" ? "eventWorkflow.unpublishToEdit" : "eventWorkflow.readOnly")}</p>
          <Link to="/organizer/events/1/preview" className="mt-4 inline-block font-semibold text-[#A93216]">{t("eventWorkflow.preview")}</Link>
        </div>
      ) : (
        <OrganizerEventForm draft={draft.data!} saveDraft={saveDraft.mutateAsync}
          previewHref={savedDraft ? "/organizer/events/1/preview" : undefined} />
      )}
      <p className="mt-6 text-xs text-[#667085]">{t("organizer.required")}</p>
    </OrganizerWorkspace>
  );
};
