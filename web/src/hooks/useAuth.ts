import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "../shared/api/auth";

export const authKeys = {
  me: ["auth", "me"] as const,
};

export const useAuth = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onSessionEnded = () => {
      void queryClient.cancelQueries({ queryKey: authKeys.me });
      queryClient.setQueryData(authKeys.me, null);
    };
    // A different account signed in elsewhere: everything cached belonged to
    // the previous one, so drop it all and let `me` load the new account.
    const onSessionChanged = () => { queryClient.clear(); void queryClient.invalidateQueries(); };
    window.addEventListener("biletflow:session-ended", onSessionEnded);
    window.addEventListener("biletflow:session-changed", onSessionChanged);
    return () => {
      window.removeEventListener("biletflow:session-ended", onSessionEnded);
      window.removeEventListener("biletflow:session-changed", onSessionChanged);
    };
  }, [queryClient]);

  const me = useQuery({
    queryKey: authKeys.me,
    queryFn: authApi.currentUser,
    retry: false,
    staleTime: 60_000,
  });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (user) => {
      await queryClient.cancelQueries({ queryKey: authKeys.me });
      queryClient.setQueryData(authKeys.me, user);
    },
  });

  const registration = useMutation({
    mutationFn: authApi.register,
  });

  const verifyEmail = useMutation({ mutationFn: authApi.verifyEmail });
  const resendVerification = useMutation({
    mutationFn: authApi.resendVerification,
  });
  const forgotPassword = useMutation({ mutationFn: authApi.forgotPassword });
  const resetPassword = useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPassword(token, password),
  });
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: authKeys.me });
      queryClient.setQueryData(authKeys.me, null);
    },
  });

  return {
    forgotPassword,
    login,
    logout,
    me,
    registration,
    resendVerification,
    resetPassword,
    verifyEmail,
  };
};
