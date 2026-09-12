import { Input } from "antd";
import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { FieldError } from "./FormControls";

type AuthFieldProps = {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  errorId?: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  className?: string;
  labelAction?: ReactNode;
};

export const AuthField = ({
  id, label, registration, error, errorId = `${id}-error`,
  type = "text", autoComplete, placeholder, className, labelAction,
}: AuthFieldProps) => {
  const { ref, ...field } = registration;
  const FieldInput = type === "password" ? Input.Password : Input;

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-[11.5px] font-semibold">{label}</label>
        {labelAction}
      </div>
      <FieldInput
        {...field}
        ref={(instance) => ref(instance?.input ?? null)}
        id={id}
        type={type}
        autoComplete={autoComplete ?? (type === "password" ? "current-password" : undefined)}
        placeholder={placeholder}
        status={error ? "error" : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
};
