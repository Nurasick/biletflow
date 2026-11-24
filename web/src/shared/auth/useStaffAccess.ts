import { useQuery } from "@tanstack/react-query";

import { operationsKeys } from "../../features/Operations/model/operationsModel";
import type { User } from "../api/auth";
import { checkInApi } from "../api/staff";

export const useStaffAccess = (user: User | null | undefined) => {
  const isOrganizer = user?.is_organizer === true;
  const shouldCheckAssignments = Boolean(user) && !isOrganizer;
  const assignments = useQuery({
    queryKey: operationsKeys.staffEvents(user?.id),
    queryFn: ({ signal }) => checkInApi.events(signal),
    enabled: shouldCheckAssignments,
    staleTime: 30_000,
    retry: false,
  });
  const isEventAdmin = assignments.isSuccess && assignments.data.some(({ role }) => role === "event_admin");
  const canCheckIn = isOrganizer || isEventAdmin;

  return {
    canCheckIn,
    canHandleSupport: canCheckIn || user?.is_platform_admin === true,
    isPending: shouldCheckAssignments && assignments.isPending,
    isError: shouldCheckAssignments && assignments.isError,
    retry: () => void assignments.refetch(),
  };
};
