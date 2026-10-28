import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { organizerEventApi } from "../../../shared/api/organizerEvents";
import type { OrganizerEventValues } from "./eventSchema";
import { organizerEventKeys } from "./useEventLifecycle";

/**
 * One event's editable values. `eventId` null means a new event: the form
 * starts empty and the first save creates the draft and reports its id.
 */
export const useOrganizerEvent = (userId: number, eventId: number | null) => {
  const queryClient = useQueryClient();
  const queryKey = organizerEventKeys.edit(userId, eventId ?? 0);
  const draft = useQuery({
    queryKey,
    queryFn: async () => eventId === null
      ? { event: null, values: organizerEventApi.empty() }
      : organizerEventApi.get(eventId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const saveDraft = useMutation({
    mutationFn: async (values: OrganizerEventValues): Promise<{ id: number; values: OrganizerEventValues }> => {
      if (eventId === null) {
        const id = await organizerEventApi.create(values);
        return { id, values: (await organizerEventApi.get(id)).values };
      }
      return { id: eventId, values: await organizerEventApi.update(eventId, values) };
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.edit(userId, id) });
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.preview(userId, id) });
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.list(userId) });
    },
  });
  return { draft, saveDraft };
};
