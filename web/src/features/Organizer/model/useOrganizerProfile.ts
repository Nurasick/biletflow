import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authKeys } from "../../../hooks/useAuth";
import { organizerApi } from "../../../shared/api/organizer";
import type { ProfileValues } from "./profileSchema";

export const organizerProfileKeys = {
  profile: (userId: number) => ["organizer", "profile", userId] as const,
  record: (userId: number) => ["organizer", "profile-record", userId] as const,
};

export const useOrganizerProfile = (userId: number, email = "") => {
  const queryClient = useQueryClient();
  const queryKey = organizerProfileKeys.profile(userId);
  const profile = useQuery({
    queryKey,
    queryFn: () => organizerApi.getProfile(email),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const saveProfile = useMutation({
    mutationFn: (values: ProfileValues) => organizerApi.saveProfile(values),
    onSuccess: async (values) => {
      queryClient.setQueryData(queryKey, values);
      // The first save makes this account an organizer: reload `me` so the
      // event pages open, and the record so verification status shows.
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
      await queryClient.invalidateQueries({ queryKey: organizerProfileKeys.record(userId) });
    },
  });

  return { profile, saveProfile };
};
