import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { useAuth } from "../../../hooks/useAuth";
import { ApiError } from "../../../shared/api/auth";

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password"),
});

type LoginValues = z.infer<typeof loginSchema>;

export const useLoginForm = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      const state = location.state as { from?: string } | null;
      const from = state?.from;
      navigate(from?.startsWith("/") && !from.startsWith("//") ? from : "/account", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fieldErrors.email) {
          setError("email", { message: error.fieldErrors.email });
        }
        if (error.fieldErrors.password) {
          setError("password", { message: error.fieldErrors.password });
        }
      }
    }
  });

  return { register, errors, onSubmit, login };
};
