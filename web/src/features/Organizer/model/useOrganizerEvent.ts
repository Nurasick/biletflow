import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { eventLifecycleApi } from "../../../shared/api/eventLifecycle";
import { OrganizerEventError, organizerEventApi } from "../../../shared/api/organizerEvents";
import type { OrganizerEventValues } from "./eventSchema";
import { organizerEventKeys } from "./useEventLifecycle";

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
    mutationFn: async (values: OrganizerEventValues) => {
      const [current] = await eventLifecycleApi.list(userId);
      if (current && current.status !== "draft") throw new OrganizerEventError("organizerEvent.saveError");
      return organizerEventApi.saveDraft(userId, values);
    },
    onSuccess: async (values) => {
      queryClient.setQueryData(queryKey, values);
      // The first save enables the status query. Fetch explicitly so saving
      // stays pending until the initial status has loaded, keeping the form mounted.
      await queryClient.fetchQuery({
        queryKey: organizerEventKeys.preview(userId, 1),
        queryFn: () => eventLifecycleApi.preview(userId, 1),
        retry: false,
      }).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.list(userId) });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: organizerEventKeys.preview(userId, 1) }),
  });
  return { draft, saveDraft };
};
