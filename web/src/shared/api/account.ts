import { api, authenticatedRequest } from "./auth";
import type { User } from "./auth";

export type AccountUpdate = {
  first_name: string;
  last_name: string;
  phone: string | null;
  locale: "kk" | "ru" | "en";
};

export const accountApi = {
  update: (values: AccountUpdate, signal?: AbortSignal) => authenticatedRequest<User>("/users/me", {
    ...api.json("PATCH", {
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      phone: values.phone?.trim() || null,
      locale: values.locale,
    }),
    signal,
  }),
};
