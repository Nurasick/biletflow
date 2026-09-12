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
    window.addEventListener("biletflow:session-ended", onSessionEnded);
    return () => window.removeEventListener("biletflow:session-ended", onSessionEnded);
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
