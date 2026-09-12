import { Checkbox } from "antd";
import { Controller } from "react-hook-form";

import { getAuthErrorMessage } from "../../../shared/api/auth";
import { useSignupForm } from "../model/useSignupForm";
import { AuthField } from "./AuthField";
import { AuthAlert, FieldError, SubmitButton } from "./FormControls";

export const SignupForm = ({ onSuccess }: { onSuccess: (email: string) => void }) => {
  const { control, register, errors, onSubmit, registration } = useSignupForm(onSuccess);

  return (
    <form className="mt-6" onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <AuthField
          id="signup-first-name" label="First name" autoComplete="given-name"
          registration={register("firstName")} error={errors.firstName?.message}
        />
        <AuthField
          id="signup-last-name" label="Last name" autoComplete="family-name"
          registration={register("lastName")} error={errors.lastName?.message}
        />
      </div>
      <AuthField
        id="signup-email" label="Email address" type="email" className="mt-4"
        autoComplete="email" placeholder="you@example.com"
        registration={register("email")} error={errors.email?.message}
      />
      <AuthField
        id="signup-password" label="Password" type="password" className="mt-4"
        autoComplete="new-password" placeholder="8+ characters"
        registration={register("password")} error={errors.password?.message}
      />
      <AuthField
        id="signup-confirm-password" label="Confirm password" type="password"
        className="mt-4" autoComplete="new-password" errorId="signup-confirm-error"
        registration={register("confirmPassword")} error={errors.confirmPassword?.message}
      />
      <div className="my-4">
        <Controller
          name="terms"
          control={control}
          render={({ field: { value, onChange, ...field } }) => (
            <Checkbox
              {...field}
              checked={value}
              onChange={(event) => onChange(event.target.checked)}
              aria-invalid={Boolean(errors.terms)}
              aria-describedby={errors.terms ? "signup-terms-error" : undefined}
            >
              I agree to the Terms of Use and Privacy Policy.
            </Checkbox>
          )}
        />
      </div>
      <FieldError id="signup-terms-error" message={errors.terms?.message} />

      {registration.isError && (
        <AuthAlert
          message={getAuthErrorMessage(
            registration.error,
            "We couldn't create your account. Please try again.",
          )}
        />
      )}
      <SubmitButton
        idleLabel="Create account"
        pendingLabel="Creating account…"
        pending={registration.isPending}
      />
    </form>
  );
};
