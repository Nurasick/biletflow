import { ArrowLeft, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { EventAccessInput } from "../../../shared/api/eventAccess";

export type UnlockStatus = "idle" | "pending" | "invalid" | "error";

const inviteFromInput = (value: string) => {
  try {
    const link = new URL(value, window.location.origin);
    return link.searchParams.get("invite") ?? link.searchParams.get("access_token") ?? value;
  } catch {
    return value;
  }
};

export function PrivateEventAccess({
  canUseCode, status, onUnlock,
}: {
  canUseCode: boolean;
  status: UnlockStatus;
  onUnlock: (credentials: EventAccessInput) => void;
}) {
  const { t } = useTranslation();
  const [useInvite, setUseInvite] = useState(!canUseCode);
  const invite = useInvite || !canUseCode;
  const pending = status === "pending";
  const showError = status === "invalid" || status === "error";

  return (
    <main className="site-container py-8 sm:py-14">
      <section aria-labelledby="private-event-title" className="panel mx-auto max-w-lg p-5 sm:p-8">
        <span className="grid size-12 place-items-center rounded-xl bg-accent-wash text-primary">
          <LockKeyhole size={23} aria-hidden="true" />
        </span>
        <h1 id="private-event-title" className="page-title mt-4">{t("booking.privateTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t(canUseCode ? "booking.privateDescription" : "booking.privateInviteDescription")}
        </p>
        <form className="mt-5 grid gap-3" aria-busy={pending} onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("credential") ?? "").trim();
          onUnlock(invite ? { invite_token: inviteFromInput(value) } : { access_code: value });
        }}>
          {canUseCode && (
            <div role="group" aria-label={t("booking.privateAccessMethod")} className="flex flex-wrap gap-2">
              {[false, true].map((mode) => (
                <button key={String(mode)} type="button" aria-pressed={invite === mode} disabled={pending} onClick={() => setUseInvite(mode)}
                  className={`action-button min-h-11 ${invite === mode ? "border-primary bg-accent-wash text-primary" : ""}`}>
                  {t(mode ? "booking.privateInvite" : "booking.privateCode")}
                </button>
              ))}
            </div>
          )}
          <label className="grid gap-1 text-sm font-semibold text-muted-strong">
            {t(invite ? "booking.privateInviteInput" : "booking.privateCode")}
            <input key={String(invite)} name="credential" type={invite ? "text" : "password"} required maxLength={invite ? 2048 : 64}
              autoComplete="off" autoCapitalize="none" spellCheck={false} readOnly={pending} aria-invalid={status === "invalid"}
              aria-describedby={showError ? "private-event-error" : undefined}
              className="min-h-11 min-w-0 rounded-lg border border-line bg-white px-3 text-base font-normal text-ink focus:border-primary" />
          </label>
          {showError && (
            <p id="private-event-error" role="alert" className="text-sm text-red-700">
              {t(status === "invalid" ? "booking.privateInvalid" : "errors.unavailable")}
            </p>
          )}
          <button type="submit" disabled={pending} className="action-button action-button--primary min-h-11 justify-self-start">
            {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {t(pending ? "common.loading" : "booking.privateUnlock")}
          </button>
        </form>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-primary-hover">
          <ArrowLeft size={17} aria-hidden="true" />{t("common.backToEvents")}
        </Link>
      </section>
    </main>
  );
}
