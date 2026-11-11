import { useTranslation } from "react-i18next";

import { ApiError } from "../../../shared/api/auth";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useSignupForm } from "../model/useSignupForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const SignupForm = ({ onSuccess }: { onSuccess: (email: string) => void }) => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { register, errors, onSubmit, registration } = useSignupForm(onSuccess);
  const errorMessage = registration.error instanceof ApiError && registration.error.status === 409
    ? t("errors.emailRegistered")
    : getAuthErrorMessage(registration.error, t("errors.signup"));

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
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
        id="signup-email" label={t("common.email")} type="email" autoComplete="email"
        registration={register("email")} error={errors.email}
      />
      <AuthField
        id="signup-password" label={t("common.password")} type="password" autoComplete="new-password"
        registration={register("password")} error={errors.password}
      />
      <p className="text-xs text-[#667085]">{t("auth.passwordHint")}</p>
      <AuthField
        id="signup-confirm-password" label={t("auth.confirmPassword")} type="password"
        autoComplete="new-password" errorId="signup-confirm-error"
        registration={register("confirmPassword")} error={errors.confirmPassword}
      />

      {registration.isError && <AuthAlert message={errorMessage} />}
      <SubmitButton
        idleLabel={t("common.createAccount")}
        pendingLabel={t("auth.creatingAccount")}
        pending={registration.isPending}
      />
    </form>
  );
};
