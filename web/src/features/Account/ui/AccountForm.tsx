import { Alert, Button, Modal } from "antd";
import { Save } from "lucide-react";
import { useEffect } from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { validationMessage } from "../../../i18n/validation";
import type { User } from "../../../shared/api/auth";
import { useUnsavedChanges } from "../../../shared/lib/useUnsavedChanges";
import { ACCOUNT_LOCALES } from "../model/accountSchema";
import { useAccountForm } from "../model/useAccountForm";

export type AccountEditingState = { isDirty: boolean; isSubmitting: boolean };

const inputClass = "h-11 w-full rounded-lg border border-[#D0D5DD] bg-[#F5F5F0] px-3 text-sm outline-none focus:border-[#FF5C35] focus:ring-2 focus:ring-[#FF5C35]/20 disabled:opacity-60";

const AccountField = ({ id, label, registration, error, type = "text", autoComplete, maxLength }: {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  type?: "text" | "tel";
  autoComplete: string;
  maxLength: number;
}) => {
  const { t } = useTranslation();
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
    <input {...registration} id={id} type={type} autoComplete={autoComplete} maxLength={maxLength}
      required={type !== "tel"} className={inputClass}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
    {error?.message && <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
      {validationMessage(t, { ...error, type: error.type === "server" ? "server" : "client" })}
    </p>}
  </div>;
};

export const AccountForm = ({ user, onEditingChange }: {
  user: User;
  onEditingChange: (state: AccountEditingState) => void;
}) => {
  const { t } = useTranslation();
  const { form, saved, onSubmit, onChange, onReset } = useAccountForm(user);
  const { register, formState: { errors, isDirty, isSubmitting } } = form;
  const blocker = useUnsavedChanges(isDirty || isSubmitting);

  useEffect(() => { onEditingChange({ isDirty, isSubmitting }); }, [isDirty, isSubmitting, onEditingChange]);
  useEffect(() => () => { onEditingChange({ isDirty: false, isSubmitting: false }); }, [onEditingChange]);

  return <section aria-labelledby="account-edit-heading" className="my-8 rounded-xl border border-[#D0D5DD] bg-white p-5 sm:p-7">
    <h2 id="account-edit-heading" className="text-xl font-bold">{t("accountEdit.title")}</h2>
    <p className="mt-2 text-sm text-[#667085]">{t("accountEdit.description")}</p>
    <form noValidate onSubmit={(event) => { if (isSubmitting) event.preventDefault(); else void onSubmit(event); }}
      onChange={onChange} aria-busy={isSubmitting} className="mt-6">
      <fieldset disabled={isSubmitting} className="min-w-0 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <AccountField id="account-first-name" label={t("accountEdit.firstName")} registration={register("first_name")}
            error={errors.first_name} autoComplete="given-name" maxLength={100} />
          <AccountField id="account-last-name" label={t("accountEdit.lastName")} registration={register("last_name")}
            error={errors.last_name} autoComplete="family-name" maxLength={100} />
        </div>
        <div>
          <label htmlFor="account-email" className="mb-1.5 block text-sm font-semibold">{t("accountEdit.email")}</label>
          <input id="account-email" type="email" value={user.email} readOnly autoComplete="email"
            className={`${inputClass} text-[#667085]`} aria-describedby="account-email-hint" />
          <p id="account-email-hint" className="mt-1.5 text-xs text-[#667085]">{t("accountEdit.emailHint")}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <AccountField id="account-phone" label={t("accountEdit.phone")} type="tel" registration={register("phone")}
            error={errors.phone} autoComplete="tel" maxLength={32} />
          <div>
            <label htmlFor="account-locale" className="mb-1.5 block text-sm font-semibold">{t("accountEdit.locale")}</label>
            <select {...register("locale")} id="account-locale" className={inputClass}
              aria-invalid={Boolean(errors.locale)} aria-describedby={errors.locale ? "account-locale-error" : "account-locale-hint"}>
              {ACCOUNT_LOCALES.map((locale) => <option key={locale} value={locale}>{t(`accountEdit.locale.${locale}`)}</option>)}
            </select>
            {errors.locale?.message && <p id="account-locale-error" className="mt-1.5 text-xs text-red-600">
              {errors.locale.type === "server" ? errors.locale.message : t("accountEdit.localeInvalid")}
            </p>}
            <p id="account-locale-hint" className="mt-1.5 text-xs text-[#667085]">{t("accountEdit.localeHint")}</p>
          </div>
        </div>
      </fieldset>
      <div aria-live="polite" className="mt-5">
        {saved && <Alert role="status" type="success" showIcon title={t("accountEdit.saved")} className="mb-4" />}
        {errors.root && <Alert role="alert" type="error" showIcon
          title={validationMessage(t, errors.root)} className="mb-4" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#D0D5DD] pt-5">
        <p className="text-xs text-[#667085]">{isDirty ? t("accountEdit.unsaved") : t("accountEdit.noChanges")}</p>
        <div className="flex flex-wrap gap-3">
          <Button htmlType="button" onClick={onReset} disabled={!isDirty || isSubmitting}>{t("accountEdit.discard")}</Button>
          <Button htmlType="submit" type="primary" icon={<Save size={16} aria-hidden="true" />}
            loading={isSubmitting} disabled={!isDirty || isSubmitting}>
            {isSubmitting ? t("accountEdit.saving") : t("accountEdit.save")}
          </Button>
        </div>
      </div>
      <Modal open={blocker.state === "blocked"} title={t("accountEdit.leaveTitle")}
        okText={t("accountEdit.leave")} cancelText={t("accountEdit.keepEditing")}
        okButtonProps={{ danger: true, disabled: isSubmitting }}
        onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}
        onOk={() => { if (blocker.state === "blocked" && !isSubmitting) blocker.proceed(); }}>
        <p>{t("accountEdit.leaveDescription")}</p>
      </Modal>
    </form>
  </section>;
};
