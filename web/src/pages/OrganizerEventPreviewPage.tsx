import { Alert } from "antd";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext, useParams } from "react-router-dom";

import { EventPublishWorkflow } from "../features/Organizer/ui/EventPublishWorkflow";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";

export const OrganizerEventPreviewPage = () => {
  const { t } = useTranslation();
  const { eventId: eventIdParam } = useParams();
  const { userId } = useOutletContext<{ userId: number }>();
  const eventId = Number(eventIdParam);
  const validId = /^[1-9]\d*$/.test(eventIdParam ?? "") && Number.isSafeInteger(eventId);
  return <OrganizerWorkspace>
    <Link to="/organizer/events" className="mb-6 inline-flex items-center gap-2 text-sm text-[#667085]">
      <ArrowLeft size={16} aria-hidden="true" />{t("eventWorkflow.myEvents")}
    </Link>
    {validId ? <EventPublishWorkflow key={`${userId}:${eventId}`} eventId={eventId} userId={userId} />
      : <Alert role="alert" type="error" title={t("eventWorkflow.notFound")} />}
  </OrganizerWorkspace>;
};
