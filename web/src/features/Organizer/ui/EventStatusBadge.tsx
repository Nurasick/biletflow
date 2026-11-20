import { useTranslation } from "react-i18next";

import type { EventStatus } from "../../../shared/api/eventLifecycle";
import type { EventPhase } from "../../../shared/api/organizerEvents";

const statusStyles: Record<EventStatus, string> = {
  draft: "border-line bg-white text-muted",
  published: "border-green-200 bg-green-50 text-green-800",
  cancelled: "border-red-200 bg-red-50 text-red-800",
  suspended: "border-amber-200 bg-amber-50 text-amber-800",
};

export const EventStatusBadge = ({ status, phase }: { status: EventStatus; phase?: EventPhase }) => {
  const { t } = useTranslation();
  const style = phase === "completed" ? statusStyles.draft : statusStyles[status];
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${style}`}>
    {t(phase ? `eventWorkflow.phase.${phase}` : `eventWorkflow.status.${status}`)}
  </span>;
};
