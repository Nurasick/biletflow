import { useMutation } from "@tanstack/react-query";
import { Alert } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { authApi } from "../shared/api/auth";

// Opened from the emailed link: /verify-email?token=... (§4.1).
export const VerifyEmailPage = () => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const verify = useMutation({ mutationFn: authApi.verifyEmail });
  const { mutate } = verify;
  useEffect(() => { if (token) mutate(token); }, [token, mutate]);

  return (
    <AuthShell top={null}>
      <AuthHeading eyebrow={t("auth.recovery")} title={t("verify.title")} description="" />
      {verify.isPending && <p role="status" className="mt-6 text-sm text-[#667085]">{t("eventWorkflow.loading")}</p>}
      {verify.isSuccess && <Alert className="mt-6" type="success" showIcon title={t("verify.done")} />}
      {(verify.isError || !token) && <Alert className="mt-6" type="error" showIcon title={t("verify.failed")} />}
      <Link to="/account" className="mt-6 inline-block font-semibold text-[#D9431F]">{t("auth.continueSignIn")}</Link>
    </AuthShell>
  );
};
