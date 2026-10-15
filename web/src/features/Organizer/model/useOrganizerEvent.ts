import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { organizerEventApi } from "../../../shared/api/organizerEvents";
import type { OrganizerEventValues } from "./eventSchema";

export const useOrganizerEvent = (userId: number) => {
  const queryClient = useQueryClient();
  const queryKey = ["organizer", "event-draft", userId];
  const draft = useQuery({
    queryKey,
    queryFn: () => organizerEventApi.getDraft(userId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const saveDraft = useMutation({
    mutationFn: (values: OrganizerEventValues) => organizerEventApi.saveDraft(userId, values),
    onSuccess: (values) => queryClient.setQueryData(queryKey, values),
  });
  return { draft, saveDraft };
};
