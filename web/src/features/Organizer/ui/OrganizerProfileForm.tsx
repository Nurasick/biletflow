import { Alert, Button, Input } from "antd";
import { Building2, FlaskConical, Save } from "lucide-react";

import { AuthField } from "../../Auth/ui/AuthField";
import { FieldError } from "../../Auth/ui/FormControls";
import type { ProfileValues } from "../model/profileSchema";
import { useOrganizerProfileForm } from "../model/useOrganizerProfileForm";

type OrganizerProfileFormProps = {
  profile: ProfileValues;
  saveProfile: (values: ProfileValues) => Promise<ProfileValues>;
};

export const OrganizerProfileForm = ({ profile, saveProfile }: OrganizerProfileFormProps) => {
  const { register, errors, isDirty, isSubmitting, saved, onSubmit, onChange, onReset } =
    useOrganizerProfileForm(profile, saveProfile);
  const { ref: descriptionRef, ...descriptionField } = register("description");

  return (
    <form onSubmit={onSubmit} onChange={onChange} noValidate aria-busy={isSubmitting}>
      <fieldset disabled={isSubmitting} className="min-w-0 space-y-6">
        <section className="rounded-xl border border-[#D0D5DD] bg-white p-5 sm:p-7" aria-labelledby="contact-heading">
          <div className="mb-6 flex items-start gap-3">
            <span className="rounded-lg bg-[#F5F5F0] p-2.5"><Building2 size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="contact-heading" className="font-semibold">Organizer details</h2>
              <p className="mt-1 text-xs leading-5 text-[#667085]">Let attendees know who is behind the event and how to reach you.</p>
            </div>
          </div>
          <AuthField id="organizer-name" label="Organizer name *" autoComplete="organization"
            registration={register("displayName")} error={errors.displayName?.message} />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <AuthField id="organizer-email" label="Contact email *" type="email" autoComplete="email"
              registration={register("contactEmail")} error={errors.contactEmail?.message} />
            <AuthField id="organizer-phone" label="Contact phone (optional)" type="tel" autoComplete="tel"
              placeholder="+7 (700) 123-45-67" registration={register("contactPhone")} error={errors.contactPhone?.message} />
          </div>
          <div className="mt-5">
            <label htmlFor="organizer-description" className="mb-1.5 block text-[11.5px] font-semibold">About your organization (optional)</label>
            <Input.TextArea {...descriptionField}
              ref={(instance) => descriptionRef(instance?.resizableTextArea?.textArea ?? null)}
              id="organizer-description" rows={4} placeholder="Tell attendees a little about your organization"
              status={errors.description ? "error" : undefined} aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? "organizer-description-error" : "organizer-description-hint"} />
            <FieldError id="organizer-description-error" message={errors.description?.message} />
            <p id="organizer-description-hint" className="mt-2 text-xs text-[#667085]">Up to 2,000 characters.</p>
          </div>
        </section>

        <section className="rounded-xl border border-[#D0D5DD] bg-white p-5 sm:p-7" aria-labelledby="payout-heading">
          <div className="mb-5 flex items-start gap-3">
            <span className="rounded-lg bg-[#FFF0EA] p-2.5 text-[#D9431F]"><FlaskConical size={20} aria-hidden="true" /></span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="payout-heading" className="font-semibold">Payout simulation</h2>
                <span className="rounded-full bg-[#FFF0EA] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#A93216]">DEMO ONLY</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#667085]">Optional test settings. No real accounts are connected and no money is transferred.</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="payout-provider" className="mb-1.5 block text-[11.5px] font-semibold">Simulation provider</label>
              <select {...register("payoutProvider")} id="payout-provider"
                aria-invalid={Boolean(errors.payoutProvider)} aria-describedby={errors.payoutProvider ? "payout-provider-error" : undefined}
                className={`h-11 w-full rounded-[9px] border bg-[#F5F5F0] px-3 text-[13px] outline-none focus:border-[#FF5C35] focus:ring-2 focus:ring-[#FF5C35]/20 ${errors.payoutProvider ? "border-red-500" : "border-[#D0D5DD]"}`}>
                <option value="">Not connected</option>
                <option value="sandbox_bank">Demo bank</option>
                <option value="sandbox_wallet">Demo wallet</option>
              </select>
              <FieldError id="payout-provider-error" message={errors.payoutProvider?.message} />
            </div>
            <AuthField id="payout-reference" label="Demo account reference" placeholder="demo_music_club" autoComplete="off"
              registration={register("payoutReference")} error={errors.payoutReference?.message} />
          </div>
          <p className="mt-4 rounded-lg bg-[#F5F5F0] px-4 py-3 text-xs leading-5 text-[#667085]">
            Use a made-up reference starting with <span className="font-mono text-[#101828]">demo_</span>. Leave both fields empty to disconnect the simulation.
          </p>
        </section>
      </fieldset>

      <div className="mt-6" aria-live="polite">
        {saved && <Alert role="status" type="success" showIcon title="Profile saved in this browser." className="mb-4" />}
        {errors.root && <Alert role="alert" type="error" showIcon title={errors.root.message} className="mb-4" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#D0D5DD] pt-5">
        <p className="text-xs text-[#667085]">{isDirty ? "You have unsaved changes." : "Your profile is up to date."}</p>
        <div className="flex gap-3">
          <Button onClick={onReset} disabled={!isDirty || isSubmitting}>Discard changes</Button>
          <Button htmlType="submit" type="primary" icon={<Save size={16} aria-hidden="true" />}
            loading={isSubmitting} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
};
