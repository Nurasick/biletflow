import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "../shared/api/auth";

export const authKeys = {
  me: ["auth", "me"] as const,
};

export const useAuth = () => {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: authKeys.me,
    queryFn: authApi.currentUser,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: (query) => query.state.data?.is_email_verified === false ? "always" : true,
  });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (user) => {
      await queryClient.cancelQueries({ queryKey: authKeys.me });
      queryClient.setQueryData(authKeys.me, user);
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    },
  });

  const registration = useMutation({
    mutationFn: authApi.register,
  });

  const verifyEmail = useMutation({ mutationFn: authApi.verifyEmail });
  const resendVerification = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: authKeys.me }); },
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
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
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
