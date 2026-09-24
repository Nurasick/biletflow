import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";

import { profileSchema } from "./profileSchema";
import type { ProfileValues } from "./profileSchema";

export const useOrganizerProfileForm = (
  profile: ProfileValues,
  saveProfile: (values: ProfileValues) => Promise<ProfileValues>,
) => {
  const [saved, setSaved] = useState(false);
  const {
    register, handleSubmit, reset, setError, clearErrors,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: profile });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    clearErrors("root");
    try {
      const result = await saveProfile(values);
      reset(result);
      setSaved(true);
    } catch (error) {
      setError("root", { message: error instanceof Error ? error.message : "Couldn't save your changes. Please try again." });
    }
  });

  const onChange = () => {
    setSaved(false);
    clearErrors("root");
  };
  const onReset = () => {
    reset();
    setSaved(false);
  };

  return { register, errors, isDirty, isSubmitting, saved, onSubmit, onChange, onReset };
};
