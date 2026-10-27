import { useTranslation } from "react-i18next";
import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { LoginForm } from "../features/Auth/ui/LoginForm";
import { SocialLogin } from "../features/Auth/ui/SocialLogin";

export const LoginPage = () => {
  const { t } = useTranslation();
  return (
    <AuthShell
      top={<AuthSwitchLink prompt={t("auth.newHere")} to="/signup" label={t("common.createAccount")} />}
    >
      <AuthHeading
        eyebrow={t("auth.welcome")}
        title={t("auth.signInTitle")}
        description={t("auth.signInDescription")}
      />
      <LoginForm />
      <SocialLogin />
    </AuthShell>
  );
};
