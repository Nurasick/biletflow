import type { ComponentProps, ReactNode } from "react";
import type { FieldError as FormFieldError, UseFormRegisterReturn } from "react-hook-form";

import { FieldError } from "../../Auth/ui/FormControls";

export const eventInputClass = "min-h-11 w-full min-w-0 rounded-[9px] border border-[#D0D5DD] bg-[#F5F5F0] px-3 py-2.5 text-[13px] text-[#101828] outline-none placeholder:text-[#667085] focus:border-[#FF5C35] focus:ring-2 focus:ring-[#FF5C35]/20 aria-invalid:border-red-500 disabled:opacity-60";

type EventFormFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: FormFieldError;
  required?: boolean;
  children: ReactNode;
};

export const EventFormField = ({ id, label, hint, error, required, children }: EventFormFieldProps) => (
  <div className="min-w-0">
    <label htmlFor={id} className="mb-1.5 block text-xs font-semibold">
      {label}{required && <span aria-hidden="true" className="text-[#A93216]"> *</span>}
    </label>
    {children}
    {hint && <p id={`${id}-hint`} className="mt-2 text-xs leading-5 text-[#667085]">{hint}</p>}
    <FieldError id={`${id}-error`} error={error} />
  </div>
);

type EventInputProps = Omit<ComponentProps<"input">, "name" | "className" | "id"> & {
  id: string;
  label: string;
  hint?: string;
  error?: FormFieldError;
  registration: UseFormRegisterReturn;
};

export const EventInput = ({ id, label, hint, error, registration, ...props }: EventInputProps) => (
  <EventFormField id={id} label={label} hint={hint} error={error} required={props.required}>
    <input {...props} {...registration} id={id} className={eventInputClass}
      aria-invalid={Boolean(error)}
      aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined} />
  </EventFormField>
);

export const EventFormSection = ({ id, number, title, description, children }: {
  id: string; number: string; title: string; description: string; children: ReactNode;
}) => (
  <section className="rounded-xl border border-[#D0D5DD] bg-white p-5 sm:p-7" aria-labelledby={id}>
    <div className="mb-6 flex items-start gap-3">
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#FFF0EA] font-mono text-xs font-semibold text-[#A93216]">{number}</span>
      <div>
        <h2 id={id} className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[#667085]">{description}</p>
      </div>
    </div>
    <div className="space-y-5">{children}</div>
  </section>
);
