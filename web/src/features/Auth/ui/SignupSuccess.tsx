import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AuthHeading } from "./AuthHeading";

export const SignupSuccess = ({ email }: { email: string }) => {
  const { t } = useTranslation();
  return (
    <div role="status">
      <AuthHeading title={t("auth.created")} />
      <p className="mt-3 text-[12.5px] leading-[1.55] text-muted">
        {t("auth.registeredWith", { email })}
      </p>
      <Link
        to="/login"
        className="mt-6 flex h-[47px] items-center justify-center rounded-[9px] bg-primary text-[13px] font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t("auth.continueSignIn")}
      </Link>
    </div>
  );
};
