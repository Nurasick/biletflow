import { Alert, Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";

import { useOrganizerEvent } from "../features/Organizer/model/useOrganizerEvent";
import { OrganizerEventForm } from "../features/Organizer/ui/OrganizerEventForm";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";

export const OrganizerEventPage = () => {
  const { t } = useTranslation();
  const { userId } = useOutletContext<{ userId: number }>();
  const { draft, saveDraft } = useOrganizerEvent(userId);

  return (
    <OrganizerWorkspace>
      <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">{t("organizerEvent.eyebrow")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("nav.createEvent")}</h1>
        <span className="rounded-full border border-[#D0D5DD] px-3 py-1 text-xs text-[#667085]">{t("organizerEvent.draft")}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{t("organizerEvent.pageDescription")}</p>
      <p className="my-6 rounded-lg border border-[#D0D5DD] px-4 py-3 text-xs leading-5 text-[#667085]">
        <span className="font-semibold text-[#101828]">{t("organizer.demoWorkspace")}</span> {t("organizerEvent.demoDescription")}
      </p>
      {draft.isPending ? (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white py-20 text-sm text-[#667085]">
          <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} aria-hidden="true" />{t("organizerEvent.loading")}
        </div>
      ) : draft.isError ? (
        <Alert role="alert" type="error" showIcon title={t("organizerEvent.loadError")}
          action={<Button onClick={() => void draft.refetch()} loading={draft.isFetching}>{t("common.retry")}</Button>} />
      ) : (
        <OrganizerEventForm draft={draft.data} saveDraft={saveDraft.mutateAsync} />
      )}
      <p className="mt-6 text-xs text-[#667085]">{t("organizer.required")}</p>
    </OrganizerWorkspace>
  );
};
