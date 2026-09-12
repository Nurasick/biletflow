import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "../../../hooks/useAuth";
import { ApiError } from "../../../shared/api/auth";
import { passwordSchema } from "./passwordSchema";

export const resetPasswordSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

export const useResetPasswordForm = (token: string) => {
  const { resetPassword } = useAuth();
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return;
    try {
      await resetPassword.mutateAsync({ token, password });
      reset();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.password) {
        setError("password", { message: error.fieldErrors.password });
      }
    }
  });

  return { register, errors, onSubmit, resetPassword };
};
