import { LockKeyhole } from "lucide-react";

import { getAuthErrorMessage } from "../../../shared/api/auth";
import { useLoginForm } from "../model/useLoginForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const LoginForm = () => {
  const { register, errors, onSubmit, login } = useLoginForm();

  return (
    <form className="mt-7" onSubmit={onSubmit} noValidate>
      <AuthField
        id="login-email" label="Email address" type="email"
        autoComplete="email" placeholder="you@example.com"
        registration={register("email")} error={errors.email?.message}
      />
      <AuthField
        id="login-password" label="Password" type="password" className="mt-4"
        registration={register("password")} error={errors.password?.message}
      />
      <div className="my-3.5 flex items-center justify-between text-[10.5px] text-[#667085]">
        <span className="flex items-center gap-1.5">
          <LockKeyhole size={12} /> Secure login
        </span>
      </div>

      {login.isError && (
        <AuthAlert
          message={getAuthErrorMessage(
            login.error,
            "We couldn't sign you in. Check your details and try again.",
          )}
        />
      )}

      <SubmitButton
        idleLabel="Sign in"
        pendingLabel="Signing in…"
        pending={login.isPending}
      />
    </form>
  );
};
