import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError } from "../../../shared/api/auth";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { useLoginForm } from "../model/useLoginForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const LoginForm = () => {
  const { t } = useTranslation();
  const getAuthErrorMessage = useAuthErrorMessage();
  const { register, errors, onSubmit, login } = useLoginForm();
  const status = login.error instanceof ApiError ? login.error.status : undefined;
  const errorMessage = status === 401 ? t("errors.signIn")
    : status === 403 ? t("errors.accountSuspended")
    : getAuthErrorMessage(login.error, t("errors.signIn"));

  return (
    <form className="mt-7 space-y-4" onSubmit={onSubmit} noValidate>
      <AuthField
        id="login-email" label={t("common.email")} type="email" autoComplete="email"
        registration={register("email")} error={errors.email}
      />
      <AuthField
        id="login-password" label={t("common.password")} type="password"
        labelAction={<Link to="/forgot-password" className="text-xs font-semibold text-[#A93216] hover:underline">{t("auth.forgotPassword")}</Link>}
        registration={register("password")} error={errors.password}
      />

      {login.isError && <AuthAlert message={errorMessage} />}

      <SubmitButton
        idleLabel={t("common.signIn")}
        pendingLabel={t("auth.signingIn")}
        pending={login.isPending}
      />
    </form>
  );
};
