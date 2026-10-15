import { useTranslation } from "react-i18next";
import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";

export const ResetPasswordPage = () => {
  const { t } = useTranslation();
  return (
    <AuthShell top={<AuthSwitchLink prompt={t("auth.backToAccount")} to="/login" label={t("common.signIn")} />}>
      <AuthHeading
        eyebrow={t("auth.recovery")}
        title={t("auth.recoverySoon")}
        description={t("auth.recoveryUnavailable")}
      />
    </AuthShell>
  );
};
