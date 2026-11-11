import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AuthHeading } from "./AuthHeading";

export const SignupSuccess = ({ email }: { email: string }) => {
  const { t } = useTranslation();
  return (
    <div role="status">
      <AuthHeading title={t("auth.created")} />
      <p className="mt-3 text-[12.5px] leading-[1.55] text-[#667085]">
        {t("auth.registeredWith", { email })}
      </p>
      <Link
        to="/login"
        className="mt-6 flex h-[47px] items-center justify-center rounded-[9px] bg-[#FF5C35] text-[13px] font-semibold text-white transition hover:bg-[#EB4E29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C35]"
      >
        {t("auth.continueSignIn")}
      </Link>
    </div>
  );
};
