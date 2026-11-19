import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
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
  // The emailed token can be consumed once. Share the result across remounts.
  const verify = useQuery({
    queryKey: ["auth", "verify-email", token],
    queryFn: () => authApi.verifyEmail(token),
    enabled: Boolean(token),
    staleTime: "static",
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <AuthShell top={null}>
      <AuthHeading title={t("verify.title")} />
      {token && verify.isPending && <p role="status" className="mt-6 text-sm text-muted">{t("verify.loading")}</p>}
      {verify.isSuccess && <Alert className="mt-6" type="success" showIcon title={t("verify.done")} />}
      {(verify.isError || !token) && <Alert className="mt-6" type="error" showIcon title={t("verify.failed")} />}
      <Link to="/account" className="mt-6 inline-block font-semibold text-primary-hover">{t("auth.continueSignIn")}</Link>
    </AuthShell>
  );
};
