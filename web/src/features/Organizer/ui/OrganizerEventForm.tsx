import { Alert, Button, Modal } from "antd";
import { Save } from "lucide-react";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { validationMessage } from "../../../i18n/validation";
import { FieldError } from "../../Auth/ui/FormControls";
import { eventTimeZones } from "../model/eventDateTime";
import { EVENT_CATEGORIES, EVENT_VISIBILITIES } from "../model/eventSchema";
import type { OrganizerEventValues } from "../model/eventSchema";
import { useOrganizerEventForm } from "../model/useOrganizerEventForm";
import { useUnsavedEvent } from "../model/useUnsavedEvent";
import { EventFormField, EventFormSection, EventInput, eventInputClass } from "./EventFormField";
import { EventImages } from "./EventImages";

export const OrganizerEventForm = ({ draft, saveDraft }: {
  draft: OrganizerEventValues;
  saveDraft: (values: OrganizerEventValues) => Promise<OrganizerEventValues>;
}) => {
  const { t } = useTranslation();
  const { form, saved, resetVersion, onSubmit, onChange, onReset } = useOrganizerEventForm(draft, saveDraft);
  const { register, control, setValue, formState: { errors, isDirty, isSubmitting, submitCount } } = form;
  const images = useWatch({ control, name: "images" });
  const description = useWatch({ control, name: "description" });
  const timeZone = useWatch({ control, name: "timeZone" });
  const [readingImages, setReadingImages] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const busy = isSubmitting || readingImages;
  const blocker = useUnsavedEvent(isDirty || busy);
  const hasFieldErrors = Object.keys(errors).some((key) => key !== "root");

  return (
    <form noValidate onSubmit={(event) => { if (busy) event.preventDefault(); else void onSubmit(event); }}
      onChange={onChange} aria-busy={busy}>
      {submitCount > 0 && hasFieldErrors && <Alert role="alert" type="error" showIcon
        title={t("organizerEvent.validationError")} className="mb-5" />}
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <EventFormSection id="event-basics-heading" number="01" title={t("organizerEvent.basics")}
          description={t("organizerEvent.basicsDescription")}>
          <EventInput id="event-title" label={t("organizerEvent.title")} required maxLength={300}
            placeholder={t("organizerEvent.titlePlaceholder")} registration={register("title")} error={errors.title} />
          <EventFormField id="event-description" label={t("organizerEvent.description")} required error={errors.description}
            hint={t("organizerEvent.descriptionHint", { count: description.length })}>
            <textarea {...register("description")} id="event-description" required rows={5} maxLength={10_000}
              className={`${eventInputClass} resize-y`} placeholder={t("organizerEvent.descriptionPlaceholder")}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={`event-description-hint${errors.description ? " event-description-error" : ""}`} />
          </EventFormField>
          <EventFormField id="event-category" label={t("organizerEvent.category")} required error={errors.category}>
            <select {...register("category")} id="event-category" required className={eventInputClass}
              aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "event-category-error" : undefined}>
              {EVENT_CATEGORIES.map((category) => <option key={category} value={category}>{t(`organizerEvent.category.${category}`)}</option>)}
            </select>
          </EventFormField>
        </EventFormSection>

        <EventFormSection id="event-images-heading" number="02" title={t("organizerEvent.images")}
          description={t("organizerEvent.imagesDescription")}>
          <EventImages key={resetVersion}
            images={images} disabled={isSubmitting} onBusyChange={setReadingImages}
            onChange={(nextImages) => {
              onChange();
              setValue("images", nextImages, { shouldDirty: true, shouldValidate: true });
            }} />
          <FieldError id="event-images-schema-error" error={errors.images?.root ?? (errors.images?.message
            ? { type: "client", message: errors.images.message } : undefined)} />
        </EventFormSection>

        <EventFormSection id="event-venue-heading" number="03" title={t("organizerEvent.venue")}
          description={t("organizerEvent.venueDescription")}>
          <EventInput id="event-venue-name" label={t("organizerEvent.venueName")} required maxLength={300}
            placeholder={t("organizerEvent.venueNamePlaceholder")} registration={register("venueName")} error={errors.venueName} />
          <EventInput id="event-venue-address" label={t("organizerEvent.venueAddress")} required maxLength={2000}
            autoComplete="street-address" placeholder={t("organizerEvent.venueAddressPlaceholder")}
            registration={register("venueAddress")} error={errors.venueAddress} />
        </EventFormSection>

        <EventFormSection id="event-schedule-heading" number="04" title={t("organizerEvent.schedule")}
          description={t("organizerEvent.scheduleDescription")}>
          <EventFormField id="event-time-zone" label={t("organizerEvent.timeZone")} required error={errors.timeZone}
            hint={t("organizerEvent.timeZoneHint")}>
            <select {...register("timeZone")} id="event-time-zone" required className={eventInputClass}
              aria-invalid={Boolean(errors.timeZone)} aria-describedby={`event-time-zone-hint${errors.timeZone ? " event-time-zone-error" : ""}`}>
              {eventTimeZones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
            </select>
          </EventFormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <EventInput id="event-starts-at" type="datetime-local" label={t("organizerEvent.startsAt")} required
              step={60} min="0001-01-01T00:00" max="9999-12-31T23:59" registration={register("startsAt")} error={errors.startsAt} />
            <EventInput id="event-ends-at" type="datetime-local" label={t("organizerEvent.endsAt")} required
              step={60} min="0001-01-01T00:00" max="9999-12-31T23:59" registration={register("endsAt")} error={errors.endsAt} />
          </div>
        </EventFormSection>

        <EventFormSection id="event-registration-heading" number="05" title={t("organizerEvent.registration")}
          description={t("organizerEvent.registrationDescription", { timeZone })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <EventInput id="event-registration-opens" type="datetime-local" label={t("organizerEvent.registrationOpens")}
              step={60} min="0001-01-01T00:00" max="9999-12-31T23:59"
              registration={register("registrationOpensAt")} error={errors.registrationOpensAt} />
            <EventInput id="event-registration-closes" type="datetime-local" label={t("organizerEvent.registrationCloses")}
              step={60} min="0001-01-01T00:00" max="9999-12-31T23:59"
              registration={register("registrationClosesAt")} error={errors.registrationClosesAt} />
          </div>
          <EventInput id="event-capacity" type="text" inputMode="numeric" label={t("organizerEvent.capacity")}
            hint={t("organizerEvent.capacityHint")} placeholder={t("organizerEvent.unlimited")}
            registration={register("capacity")} error={errors.capacity} />
        </EventFormSection>

        <EventFormSection id="event-visibility-heading" number="06" title={t("organizerEvent.visibility")}
          description={t("organizerEvent.visibilityDescription")}>
          <div role="radiogroup" aria-labelledby="event-visibility-heading" aria-invalid={Boolean(errors.visibility)}
            aria-describedby={errors.visibility ? "event-visibility-error" : undefined} className="grid gap-3 sm:grid-cols-3">
            {EVENT_VISIBILITIES.map((visibility) => (
              <label key={visibility} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#D0D5DD] p-4 has-checked:border-[#FF5C35] has-checked:bg-[#FFF0EA] has-focus-visible:ring-2 has-focus-visible:ring-[#FF5C35]">
                <input {...register("visibility")} type="radio" value={visibility} className="mt-0.5 accent-[#FF5C35]" />
                <span>
                  <span className="block text-xs font-semibold">{t(`organizerEvent.visibility.${visibility}`)}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#667085]">{t(`organizerEvent.visibility.${visibility}Description`)}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldError id="event-visibility-error" error={errors.visibility} />
        </EventFormSection>
      </fieldset>

      <div aria-live="polite" className="mt-6">
        {saved && <Alert role="status" type="success" showIcon title={t("organizerEvent.saved")} className="mb-4" />}
        {errors.root && <Alert role="alert" type="error" showIcon title={validationMessage(t, errors.root)} className="mb-4" />}
      </div>
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-4 border-t border-[#D0D5DD] bg-[#F5F5F0]/95 px-1 py-5 backdrop-blur-sm">
        <p role="status" className="text-xs text-[#667085]">
          {readingImages ? t("organizerEvent.readingImages") : isDirty ? t("organizer.unsaved") : t("organizerEvent.noChanges")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button htmlType="button" onClick={() => setDiscardOpen(true)} disabled={!isDirty || busy}>{t("organizer.discard")}</Button>
          <Button htmlType="submit" type="primary" loading={isSubmitting} disabled={!isDirty || busy}
            icon={<Save size={16} aria-hidden="true" />}>
            {isSubmitting ? t("organizer.saving") : t("organizerEvent.saveDraft")}
          </Button>
        </div>
      </div>
      <Modal open={discardOpen} title={t("organizerEvent.discardTitle")} okText={t("organizer.discard")}
        cancelText={t("organizerEvent.keepEditing")} okButtonProps={{ danger: true }}
        onCancel={() => setDiscardOpen(false)} onOk={() => { onReset(); setDiscardOpen(false); }}>
        <p>{t("organizerEvent.discardDescription")}</p>
      </Modal>
      <Modal open={blocker.state === "blocked"} title={t("organizerEvent.leaveTitle")}
        okText={t("organizerEvent.leave")} cancelText={t("organizerEvent.keepEditing")}
        okButtonProps={{ danger: true, disabled: busy }}
        onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}
        onOk={() => { if (blocker.state === "blocked" && !busy) blocker.proceed(); }}>
        <p>{t("organizerEvent.leaveDescription")}</p>
      </Modal>
    </form>
  );
};
