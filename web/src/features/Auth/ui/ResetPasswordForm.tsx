import { useTranslation } from "react-i18next";
import { Alert } from "antd";
import { Link } from "react-router-dom";

import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useResetPasswordForm } from "../model/useResetPasswordForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const ResetPasswordForm = ({ token }: { token: string }) => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { register, errors, onSubmit, resetPassword } = useResetPasswordForm(token);

  if (resetPassword.isSuccess) {
    return (
      <Alert
        className="mt-6" role="status" type="success" showIcon
        title={t("auth.passwordUpdated")}
        description={t("auth.passwordUpdatedDescription")}
      />
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
      <AuthField
        id="reset-password" label={t("auth.newPassword")} type="password"
        autoComplete="new-password" placeholder={t("common.passwordPlaceholder")}
        registration={register("password")} error={errors.password}
      />
      <p className="text-xs text-[#667085]">{t("auth.passwordHint")}</p>
      <AuthField
        id="reset-confirm-password" label={t("auth.confirmNewPassword")} type="password"
        autoComplete="new-password"
        registration={register("confirmPassword")} error={errors.confirmPassword}
      />
      {resetPassword.isError && (
        <div>
          <AuthAlert message={getAuthErrorMessage(resetPassword.error, t("errors.resetPassword"))} />
          <Link to="/forgot-password" className="text-sm font-semibold text-[#D9431F]">
            {t("auth.newResetLink")}
          </Link>
        </div>
      )}
      <SubmitButton idleLabel={t("auth.resetPassword")} pendingLabel={t("auth.resetting")} pending={resetPassword.isPending} />
    </form>
  );
};
