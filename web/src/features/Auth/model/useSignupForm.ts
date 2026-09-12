import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "../../../hooks/useAuth";
import { ApiError } from "../../../shared/api/auth";
import { passwordSchema } from "./passwordSchema";

const signupSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name").max(100),
    lastName: z.string().trim().min(1, "Enter your last name").max(100),
    email: z.email("Enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string(),
    terms: z.boolean().refine(Boolean, "Accept the terms to continue"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type SignupValues = z.infer<typeof signupSchema>;

export const useSignupForm = (onSuccess: (email: string) => void) => {
  const { registration } = useAuth();
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
        locale: "en",
      });
      onSuccess(values.email);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fieldErrors.first_name) {
          setError("firstName", { message: error.fieldErrors.first_name });
        }
        if (error.fieldErrors.last_name) {
          setError("lastName", { message: error.fieldErrors.last_name });
        }
        if (error.fieldErrors.email) {
          setError("email", { message: error.fieldErrors.email });
        }
        if (error.fieldErrors.password) {
          setError("password", { message: error.fieldErrors.password });
        }
      }
    }
  });

  return { control, register, errors, onSubmit, registration };
};
