import { useTranslation } from "react-i18next";
import { Alert, Button, Input } from "antd";
import { Building2, FlaskConical, Save } from "lucide-react";
import { validationMessage } from "../../../i18n/validation";

import { AuthField } from "../../Auth/ui/AuthField";
import { FieldError } from "../../Auth/ui/FormControls";
import type { ProfileValues } from "../model/profileSchema";
import { useOrganizerProfileForm } from "../model/useOrganizerProfileForm";

type OrganizerProfileFormProps = {
  profile: ProfileValues;
  saveProfile: (values: ProfileValues) => Promise<ProfileValues>;
};

export const OrganizerProfileForm = ({ profile, saveProfile }: OrganizerProfileFormProps) => {
  const { t } = useTranslation();
  const { register, errors, isDirty, isSubmitting, saved, onSubmit, onChange, onReset } =
    useOrganizerProfileForm(profile, saveProfile);
  const { ref: descriptionRef, ...descriptionField } = register("description");

  return (
    <form onSubmit={onSubmit} onChange={onChange} noValidate aria-busy={isSubmitting}>
      <fieldset disabled={isSubmitting} className="min-w-0 space-y-6">
        <section className="rounded-xl border border-line bg-white p-5 sm:p-7" aria-labelledby="contact-heading">
          <div className="mb-6 flex items-start gap-3">
            <span className="rounded-lg bg-paper p-2.5"><Building2 size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="contact-heading" className="font-semibold">{t("organizer.details")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted">{t("organizer.detailsDescription")}</p>
            </div>
          </div>
          <AuthField id="organizer-name" label={t("organizer.name")} autoComplete="organization"
            registration={register("displayName")} error={errors.displayName} />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <AuthField id="organizer-email" label={t("organizer.email")} type="email" autoComplete="email"
              registration={register("contactEmail")} error={errors.contactEmail} />
            <AuthField id="organizer-phone" label={t("organizer.phone")} type="tel" autoComplete="tel"
              registration={register("contactPhone")} error={errors.contactPhone} />
          </div>
          <div className="mt-5">
            <label htmlFor="organizer-description" className="mb-1.5 block text-[11.5px] font-semibold">{t("organizer.about")}</label>
            <Input.TextArea {...descriptionField}
              ref={(instance) => descriptionRef(instance?.resizableTextArea?.textArea ?? null)}
              id="organizer-description" rows={4}
              status={errors.description ? "error" : undefined} aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? "organizer-description-error" : "organizer-description-hint"} />
            <FieldError id="organizer-description-error" error={errors.description} />
            <p id="organizer-description-hint" className="mt-2 text-xs text-muted">{t("organizer.descriptionHint")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5 sm:p-7" aria-labelledby="payout-heading">
          <div className="mb-5 flex items-start gap-3">
            <span className="rounded-lg bg-accent-wash p-2.5 text-primary-hover"><FlaskConical size={20} aria-hidden="true" /></span>
            <div className="flex-1">
              <h2 id="payout-heading" className="font-semibold">{t("organizer.payout")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted">{t("organizer.payoutDescription")}</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="payout-provider" className="mb-1.5 block text-[11.5px] font-semibold">{t("organizer.provider")}</label>
              <select {...register("payoutProvider")} id="payout-provider"
                aria-invalid={Boolean(errors.payoutProvider)} aria-describedby={errors.payoutProvider ? "payout-provider-error" : undefined}
                className={`h-11 w-full rounded-[9px] border bg-paper px-3 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${errors.payoutProvider ? "border-red-500" : "border-line"}`}>
                <option value="">{t("organizer.notConnected")}</option>
                <option value="sandbox_bank">{t("organizer.demoBank")}</option>
                <option value="sandbox_wallet">{t("organizer.demoWallet")}</option>
              </select>
              <FieldError id="payout-provider-error" error={errors.payoutProvider} />
            </div>
            <AuthField id="payout-reference" label={t("organizer.reference")} autoComplete="off"
              registration={register("payoutReference")} error={errors.payoutReference} />
          </div>
          <p className="mt-4 rounded-lg bg-paper px-4 py-3 text-xs leading-5 text-muted">
            {t("organizer.referenceHint")}
          </p>
        </section>
      </fieldset>

      <div className="mt-6" aria-live="polite">
        {saved && <Alert role="status" type="success" showIcon title={t("organizer.saved")} className="mb-4" />}
        {errors.root && <Alert role="alert" type="error" showIcon title={validationMessage(t, errors.root)} className="mb-4" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <p className="text-xs text-muted">{isDirty ? t("organizer.unsaved") : t("organizer.upToDate")}</p>
        <div className="flex gap-3">
          <Button onClick={onReset} disabled={!isDirty || isSubmitting}>{t("organizer.discard")}</Button>
          <Button htmlType="submit" type="primary" icon={<Save size={16} aria-hidden="true" />}
            loading={isSubmitting} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? t("organizer.saving") : t("organizer.save")}
          </Button>
        </div>
      </div>
    </form>
  );
};
