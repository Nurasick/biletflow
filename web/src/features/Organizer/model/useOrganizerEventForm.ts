import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { OrganizerEventError } from "../../../shared/api/organizerEvents";
import { eventSchema } from "./eventSchema";
import type { OrganizerEventValues } from "./eventSchema";

export const useOrganizerEventForm = (
  draft: OrganizerEventValues,
  saveDraft: (values: OrganizerEventValues) => Promise<OrganizerEventValues>,
) => {
  const [saved, setSaved] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const form = useForm<OrganizerEventValues>({
    resolver: zodResolver(eventSchema), defaultValues: draft, mode: "onBlur",
  });
  const onChange = () => {
    setSaved(false);
    form.clearErrors("root");
  };
  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    form.clearErrors("root");
    try {
      form.reset(await saveDraft(values));
      setResetVersion((version) => version + 1);
      setSaved(true);
    } catch (error) {
      form.setError("root", {
        type: "client", message: error instanceof OrganizerEventError ? error.message : "organizerEvent.saveError",
      });
    }
  });
  const onReset = () => { form.reset(); setSaved(false); setResetVersion((version) => version + 1); };

  return { form, saved, resetVersion, onSubmit, onChange, onReset };
};
