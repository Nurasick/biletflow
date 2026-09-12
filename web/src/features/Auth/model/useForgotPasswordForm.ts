import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "../../../hooks/useAuth";
import { ApiError } from "../../../shared/api/auth";

const schema = z.object({ email: z.string().trim().pipe(z.email("Enter a valid email address")) });

export const useForgotPasswordForm = () => {
  const { forgotPassword } = useAuth();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await forgotPassword.mutateAsync(email);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.email) {
        setError("email", { message: error.fieldErrors.email });
      }
    }
  });

  return { register, errors, onSubmit, forgotPassword };
};
