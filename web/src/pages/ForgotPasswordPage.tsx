import { useTranslation } from "react-i18next";
import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { ForgotPasswordForm } from "../features/Auth/ui/ForgotPasswordForm";

export const ForgotPasswordPage = () => {
  const { t } = useTranslation();
  return (
    <AuthShell top={<AuthSwitchLink prompt={t("auth.backToAccount")} to="/login" label={t("common.signIn")} />}>
      <AuthHeading eyebrow={t("auth.recovery")} title={t("auth.sendReset")} description={t("auth.tryEmail")} />
      <ForgotPasswordForm />
    </AuthShell>
  );
};
