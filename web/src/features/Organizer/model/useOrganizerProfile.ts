import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { organizerApi } from "../../../shared/api/organizer";
import type { ProfileValues } from "./profileSchema";

export const useOrganizerProfile = (userId: number) => {
  const queryClient = useQueryClient();
  const queryKey = ["organizer", "profile", userId];
  const profile = useQuery({
    queryKey,
    queryFn: () => organizerApi.getProfile(userId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const saveProfile = useMutation({
    mutationFn: (values: ProfileValues) => organizerApi.saveProfile(userId, values),
    onSuccess: (values) => queryClient.setQueryData(queryKey, values),
  });

  return { profile, saveProfile };
};
