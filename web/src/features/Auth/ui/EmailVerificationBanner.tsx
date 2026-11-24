import { CircleCheck, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../../hooks/useAuth";
import { ApiError, type User } from "../../../shared/api/auth";

const cooldownMs = 60_000;
const remainingSeconds = (deadline: number) =>
  Math.min(cooldownMs / 1000, Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

const VerificationResend = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const { resendVerification } = useAuth();
  const storageKey = `biletflow.verification.resend.${userId}`;
  const [deadline, setDeadline] = useState(() => {
    try {
      return Number(sessionStorage.getItem(storageKey)) || 0;
    } catch {
      return 0;
    }
  });
  const [seconds, setSeconds] = useState(() => remainingSeconds(deadline));
  const rateLimited = resendVerification.error instanceof ApiError && resendVerification.error.status === 429;

  useEffect(() => {
    if (remainingSeconds(deadline) === 0) return;
    const timer = window.setInterval(() => {
      const next = remainingSeconds(deadline);
      setSeconds(next);
      if (next === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const send = async () => {
    try {
      await resendVerification.mutateAsync();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429) return;
    }

    const next = Date.now() + cooldownMs;
    setDeadline(next);
    setSeconds(cooldownMs / 1000);
    try {
      sessionStorage.setItem(storageKey, String(next));
    } catch {
      // The in-memory cooldown still applies if browser storage is unavailable.
    }
  };

  return (
    <div className="mt-3">
      <button type="button" disabled={resendVerification.isPending || seconds > 0}
        className="action-button" onClick={() => void send()}>
        {resendVerification.isPending ? t("auth.sending")
          : seconds > 0 ? t("booking.emailResendCooldown", { seconds }) : t("booking.emailResend")}
      </button>
      {resendVerification.isSuccess && <p role="status" className="mt-2 text-sm text-emerald-800">{t("booking.emailResendSent")}</p>}
      {resendVerification.isError && !rateLimited && <p role="alert" className="mt-2 text-sm text-red-800">{t("booking.emailResendFailed")}</p>}
    </div>
  );
};

export const EmailVerificationBanner = ({ user, signedIn = false }: {
  user: Pick<User, "id" | "is_email_verified">;
  signedIn?: boolean;
}) => {
  const { t } = useTranslation();
  const verified = user.is_email_verified;
  const StatusIcon = verified ? CircleCheck : Mail;

  return (
    <div id="email-verification" className={`flex items-start gap-3 rounded-xl border p-4 ${verified
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-950"}`}>
      <StatusIcon className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{t(verified ? "verify.done" : "booking.emailUnverified")}</p>
        {!verified && (
          <>
            <p className="mt-1 text-sm">{t("booking.emailVerificationInstructions")}</p>
            {signedIn ? <VerificationResend key={user.id} userId={user.id} />
              : <p className="mt-2 text-sm">{t("booking.emailResendSignIn")}</p>}
          </>
        )}
      </div>
    </div>
  );
};
