import { useTranslation } from "react-i18next";
import { LockKeyhole } from "lucide-react";

import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useLoginForm } from "../model/useLoginForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const LoginForm = () => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { register, errors, onSubmit, login } = useLoginForm();

  return (
    <form className="mt-7" onSubmit={onSubmit} noValidate>
      <AuthField
        id="login-email" label={t("common.email")} type="email"
        autoComplete="email" placeholder={t("common.emailPlaceholder")}
        registration={register("email")} error={errors.email}
      />
      <AuthField
        id="login-password" label={t("common.password")} type="password" className="mt-4"
        registration={register("password")} error={errors.password}
      />
      <div className="my-3.5 flex items-center justify-between text-[10.5px] text-[#667085]">
        <span className="flex items-center gap-1.5">
          <LockKeyhole size={12} /> {t("auth.secureLogin")}
        </span>
      </div>

      {login.isError && (
        <AuthAlert
          message={getAuthErrorMessage(
            login.error,
            t("errors.signIn"),
          )}
        />
      )}

      <SubmitButton
        idleLabel={t("common.signIn")}
        pendingLabel={t("auth.signingIn")}
        pending={login.isPending}
      />
    </form>
  );
};
