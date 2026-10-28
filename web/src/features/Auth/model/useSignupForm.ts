import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { resolveLocale } from "../../../i18n/config";
import { useAuth } from "../../../hooks/useAuth";
import { ApiError } from "../../../shared/api/auth";
import { passwordSchema } from "./passwordSchema";

const signupSchema = z
  .object({
    firstName: z.string().trim().min(1, "validation.firstName").max(100, "validation.nameMax"),
    lastName: z.string().trim().min(1, "validation.lastName").max(100, "validation.nameMax"),
    email: z.email("validation.email"),
    password: passwordSchema,
    confirmPassword: z.string(),
    terms: z.boolean().refine(Boolean, "validation.terms"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "validation.passwordMismatch",
  });

type SignupValues = z.infer<typeof signupSchema>;

export const useSignupForm = (onSuccess: (email: string) => void) => {
  const { registration } = useAuth();
  const { i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      terms: false,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registration.mutateAsync({
        first_name: values.firstName,
        last_name: values.lastName,
        email: values.email,
        password: values.password,
        // The language the person is using right now (audit #23).
        locale,
      });
      onSuccess(values.email);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fieldErrors.first_name) {
          setError("firstName", { type: "server", message: error.fieldErrors.first_name });
        }
        if (error.fieldErrors.last_name) {
          setError("lastName", { type: "server", message: error.fieldErrors.last_name });
        }
        if (error.fieldErrors.email) {
          setError("email", { type: "server", message: error.fieldErrors.email });
        }
        if (error.fieldErrors.password) {
          setError("password", { type: "server", message: error.fieldErrors.password });
        }
      }
    }
  });

  return { control, register, errors, onSubmit, registration };
};
