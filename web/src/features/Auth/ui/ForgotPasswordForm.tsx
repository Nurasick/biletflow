import { useTranslation } from "react-i18next";
import { Alert, Button } from "antd";

import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useForgotPasswordForm } from "../model/useForgotPasswordForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const ForgotPasswordForm = () => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { register, errors, onSubmit, forgotPassword } = useForgotPasswordForm();

  if (forgotPassword.isSuccess) {
    return (
      <div className="mt-6">
        <Alert
          role="status" type="success" showIcon title={t("auth.checkEmail")}
          description={t("auth.resetEmailSent")}
        />
        <Button className="mt-4" block onClick={() => forgotPassword.reset()}>
          {t("auth.tryEmail")}
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
      <AuthField
        id="forgot-email" label={t("common.email")} type="email"
        autoComplete="email" placeholder={t("common.emailPlaceholder")}
        registration={register("email")} error={errors.email}
      />
      {forgotPassword.isError && (
        <AuthAlert message={getAuthErrorMessage(forgotPassword.error, t("errors.sendReset"))} />
      )}
      <SubmitButton idleLabel={t("auth.sendReset")} pendingLabel={t("auth.sending")} pending={forgotPassword.isPending} />
    </form>
  );
};
