import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { OrganizerEventError } from "../../../shared/api/organizerEvents";
import { ApiError } from "../../../shared/api/auth";
import { eventSchema } from "./eventSchema";
import type { OrganizerEventValues } from "./eventSchema";

const serverFields: Record<string, keyof OrganizerEventValues> = {
  title: "title", description: "description", category: "category", refund_policy: "refundPolicy",
  venue_name: "venueName", venue_address: "venueAddress", timezone: "timeZone",
  starts_at: "startsAt", ends_at: "endsAt", capacity: "capacity", visibility: "visibility",
  registration_opens_at: "registrationOpensAt", registration_closes_at: "registrationClosesAt",
};

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
      if (error instanceof ApiError && error.status === 422) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (serverFields[field]) form.setError(serverFields[field], { type: "server", message });
        }
        form.setError("root", { type: "server", message: error.message });
        return;
      }
      form.setError("root", {
        type: "client", message: error instanceof OrganizerEventError ? error.message : "organizerEvent.saveError",
      });
    }
  });
  const onReset = () => { form.reset(); setSaved(false); setResetVersion((version) => version + 1); };

  return { form, saved, resetVersion, onSubmit, onChange, onReset };
};
