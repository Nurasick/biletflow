import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext, useParams } from "react-router-dom";

import { EventAnalyticsPanel } from "../features/Organizer/ui/EventAnalyticsPanel";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import { ReportError, ReportLoading } from "../features/Organizer/ui/ReportControls";
import { organizerEventApi } from "../shared/api/organizerEvents";
import type { OrganizerContext } from "../shared/auth/OrganizerRoute";

export const OrganizerAnalyticsPage = () => {
  const { t } = useTranslation();
  const { eventId: eventIdParam = "" } = useParams();
  const { userId } = useOutletContext<OrganizerContext>();
  const eventId = Number(eventIdParam);
  const validId = /^[1-9]\d*$/.test(eventIdParam) && Number.isSafeInteger(eventId);
  const event = useQuery({
    queryKey: ["organizer", "analytics-event", userId, eventId],
    queryFn: ({ signal }) => organizerEventApi.read(eventId, signal),
    enabled: validId, retry: false,
  });

  return <OrganizerWorkspace>
    <Link to={validId ? `/organizer/events/${eventId}/preview` : "/organizer/events"}
      className="mb-5 inline-flex items-center gap-2 text-sm text-[#667085] hover:underline">
      <ArrowLeft size={16} aria-hidden="true" />{t(validId ? "eventWorkflow.preview" : "eventWorkflow.myEvents")}
    </Link>
    <h1 className="text-3xl font-bold tracking-tight">{t("analytics.title")}</h1>
    {!validId ? <Alert className="mt-5" role="alert" type="error" showIcon title={t("eventWorkflow.notFound")} />
      : event.isPending ? <ReportLoading />
        : event.isError ? <div className="mt-5"><ReportError error={event.error}
          retry={() => void event.refetch()} fetching={event.isFetching} /></div>
          : <>
            <p className="mt-2 break-words text-sm text-[#667085]">{event.data.title}</p>
            <EventAnalyticsPanel key={`${userId}:${eventId}:${event.data.timezone}`}
              eventId={eventId} userId={userId} timeZone={event.data.timezone} />
          </>}
  </OrganizerWorkspace>;
};
