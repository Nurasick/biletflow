import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { eventLifecycleApi } from "../../../shared/api/eventLifecycle";
import type { EventAction } from "../../../shared/api/eventLifecycle";

export const organizerEventKeys = {
  list: (userId: number) => ["organizer", "events", userId] as const,
  preview: (userId: number, eventId: number) => ["organizer", "event-preview", userId, eventId] as const,
  edit: (userId: number, eventId: number) => ["organizer", "event-edit", userId, eventId] as const,
  ticketTypes: (eventId: number) => ["organizer", "ticket-types", eventId] as const,
};

export const useEventWorkflowSync = (userId: number) => {
  const queryClient = useQueryClient();
  useEffect(() => eventLifecycleApi.subscribe(userId, () => {
    void queryClient.invalidateQueries({ queryKey: ["organizer", "event-preview", userId] });
    void queryClient.invalidateQueries({ queryKey: organizerEventKeys.list(userId) });
  }), [userId, queryClient]);
};

export const useEventLifecycle = (userId: number, eventId: number, enabled = true) => {
  const queryClient = useQueryClient();
  const queryKey = organizerEventKeys.preview(userId, eventId);
  useEventWorkflowSync(userId);
  const preview = useQuery({
    queryKey,
    enabled,
    queryFn: () => eventLifecycleApi.preview(userId, eventId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
  const transition = useMutation({
    mutationFn: (action: EventAction) => eventLifecycleApi.transition(userId, eventId, action),
    // Cancel old reads so they cannot replace the action's server response.
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(queryKey, snapshot);
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.list(userId) });
    },
    // A failed or interrupted request may still have committed on the server.
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: organizerEventKeys.list(userId) });
    },
    retry: false,
  });
  return { preview, transition };
};
