import { useTranslation } from "react-i18next";
import { useState } from "react";

import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { SignupForm } from "../features/Auth/ui/SignupForm";
import { SignupSuccess } from "../features/Auth/ui/SignupSuccess";
import type { User } from "../shared/api/auth";

export const SignupPage = () => {
  const { t } = useTranslation();
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);

  return (
    <AuthShell
      top={<AuthSwitchLink prompt={t("auth.existingAccount")} to="/login" label={t("common.signIn")} />}
    >
      {registeredUser ? (
        <SignupSuccess user={registeredUser} />
      ) : (
        <>
          <AuthHeading title={t("auth.signupTitle")} />
          <SignupForm onSuccess={setRegisteredUser} />
        </>
      )}
    </AuthShell>
  );
};
