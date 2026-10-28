import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { ResetPasswordForm } from "../features/Auth/ui/ResetPasswordForm";

// Opened from the emailed link: /reset-password?token=...
export const ResetPasswordPage = () => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  return (
    <AuthShell top={<AuthSwitchLink prompt={t("auth.backToAccount")} to="/login" label={t("common.signIn")} />}>
      <AuthHeading eyebrow={t("auth.recovery")} title={t("auth.resetPassword")} description={t("auth.passwordHint")} />
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
};
