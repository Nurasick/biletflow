import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";

import { organizerEventKeys } from "../features/Organizer/model/useEventLifecycle";
import { EventAnalyticsPanel } from "../features/Organizer/ui/EventAnalyticsPanel";
import { eventInputClass } from "../features/Organizer/ui/EventFormField";
import { OrganizerAnalyticsOverview } from "../features/Organizer/ui/OrganizerAnalyticsOverview";
import { OrganizerWorkspace } from "../features/Organizer/ui/OrganizerWorkspace";
import { ReportError, ReportLoading } from "../features/Organizer/ui/ReportControls";
import { eventLifecycleApi } from "../shared/api/eventLifecycle";
import { organizerEventApi } from "../shared/api/organizerEvents";
import type { OrganizerContext } from "../shared/auth/OrganizerRoute";

// /organizer/analytics: every event; /organizer/events/:id/analytics: one event.
export const OrganizerAnalyticsPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId: eventIdParam } = useParams();
  const { userId } = useOutletContext<OrganizerContext>();
  const overview = eventIdParam === undefined;
  const eventId = Number(eventIdParam);
  const validId = overview || (/^[1-9]\d*$/.test(eventIdParam) && Number.isSafeInteger(eventId));
  const events = useQuery({
    queryKey: organizerEventKeys.list(userId), queryFn: () => eventLifecycleApi.list(userId), retry: false,
  });
  const event = useQuery({
    queryKey: ["organizer", "analytics-event", userId, eventId],
    queryFn: ({ signal }) => organizerEventApi.read(eventId, signal),
    enabled: !overview && validId, retry: false,
  });

  return <OrganizerWorkspace>
    <Link to={!overview && validId ? `/organizer/events/${eventId}/preview` : "/organizer/events"}
      className="mb-5 inline-flex items-center gap-2 text-sm text-muted hover:underline">
      <ArrowLeft size={16} aria-hidden="true" />{t(!overview && validId ? "eventWorkflow.preview" : "eventWorkflow.myEvents")}
    </Link>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="page-title">{t(overview ? "analytics.overviewTitle" : "analytics.title")}</h1>
      <label className="w-full min-w-0 text-sm font-semibold sm:w-80">
        {t("analytics.eventSwitcher")}
        <select className={`mt-1.5 ${eventInputClass}`} value={overview ? "" : String(eventId)} disabled={!events.data}
          onChange={(change) => void navigate(change.target.value
            ? `/organizer/events/${change.target.value}/analytics` : "/organizer/analytics")}>
          <option value="">{t("analytics.allEvents")}</option>
          {events.data?.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          {/* Keep the current event selectable while the list loads or if it is not in it. */}
          {!overview && validId && !events.data?.some((item) => item.id === eventId) && event.data &&
            <option value={eventId}>{event.data.title}</option>}
        </select>
      </label>
    </div>
    {events.isError && <Alert className="mt-4" role="alert" type="warning" showIcon title={t("analytics.eventsLoadError")} />}
    {overview ? <OrganizerAnalyticsOverview userId={userId} />
      : !validId ? <Alert className="mt-5" role="alert" type="error" showIcon title={t("eventWorkflow.notFound")} />
        : event.isPending ? <ReportLoading />
          : event.isError ? <div className="mt-5"><ReportError error={event.error}
            retry={() => void event.refetch()} fetching={event.isFetching} /></div>
            : <>
              <p className="mt-2 break-words text-sm text-muted">{event.data.title}</p>
              <EventAnalyticsPanel key={`${userId}:${eventId}:${event.data.timezone}`}
                eventId={eventId} userId={userId} timeZone={event.data.timezone} />
            </>}
  </OrganizerWorkspace>;
};
