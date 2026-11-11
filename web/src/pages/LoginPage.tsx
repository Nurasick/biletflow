import { useTranslation } from "react-i18next";
import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { LoginForm } from "../features/Auth/ui/LoginForm";

export const LoginPage = () => {
  const { t } = useTranslation();
  return (
    <AuthShell
      top={<AuthSwitchLink prompt={t("auth.newHere")} to="/signup" label={t("common.createAccount")} />}
    >
      <AuthHeading title={t("auth.signInTitle")} />
      <LoginForm />
    </AuthShell>
  );
};
