import { useTranslation } from "react-i18next";
import { Checkbox } from "antd";
import { Controller } from "react-hook-form";

import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useSignupForm } from "../model/useSignupForm";
import { AuthField } from "./AuthField";
import { AuthAlert, FieldError, SubmitButton } from "./FormControls";

export const SignupForm = ({ onSuccess }: { onSuccess: (email: string) => void }) => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { control, register, errors, onSubmit, registration } = useSignupForm(onSuccess);

  return (
    <form className="mt-6" onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <AuthField
          id="signup-first-name" label={t("common.firstName")} autoComplete="given-name"
          registration={register("firstName")} error={errors.firstName}
        />
        <AuthField
          id="signup-last-name" label={t("common.lastName")} autoComplete="family-name"
          registration={register("lastName")} error={errors.lastName}
        />
      </div>
      <AuthField
        id="signup-email" label={t("common.email")} type="email" className="mt-4"
        autoComplete="email" placeholder={t("common.emailPlaceholder")}
        registration={register("email")} error={errors.email}
      />
      <AuthField
        id="signup-password" label={t("common.password")} type="password" className="mt-4"
        autoComplete="new-password" placeholder={t("common.passwordPlaceholder")}
        registration={register("password")} error={errors.password}
      />
      <AuthField
        id="signup-confirm-password" label={t("auth.confirmPassword")} type="password"
        className="mt-4" autoComplete="new-password" errorId="signup-confirm-error"
        registration={register("confirmPassword")} error={errors.confirmPassword}
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
              {t("auth.acceptTerms")}
            </Checkbox>
          )}
        />
      </div>
      <FieldError id="signup-terms-error" error={errors.terms} />

      {registration.isError && (
        <AuthAlert
          message={getAuthErrorMessage(
            registration.error,
            t("errors.signup"),
          )}
        />
      )}
      <SubmitButton
        idleLabel={t("common.createAccount")}
        pendingLabel={t("auth.creatingAccount")}
        pending={registration.isPending}
      />
    </form>
  );
};
