import { useTranslation } from "react-i18next";

import type { EventStatus } from "../../../shared/api/eventLifecycle";

const statusStyles: Record<EventStatus, string> = {
  draft: "border-[#D0D5DD] bg-white text-[#667085]",
  published: "border-green-200 bg-green-50 text-green-800",
  cancelled: "border-red-200 bg-red-50 text-red-800",
  suspended: "border-amber-200 bg-amber-50 text-amber-800",
};

export const EventStatusBadge = ({ status }: { status: EventStatus }) => {
  const { t } = useTranslation();
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[status]}`}>
    {t(`eventWorkflow.status.${status}`)}
  </span>;
};
