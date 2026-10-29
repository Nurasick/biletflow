import { z } from "zod";

import type { User } from "../../../shared/api/auth";

export const ACCOUNT_LOCALES = ["kk", "ru", "en"] as const;

export const accountSchema = z.object({
  first_name: z.string().trim().min(1, "accountEdit.nameRequired").max(100, "accountEdit.nameMax"),
  last_name: z.string().trim().min(1, "accountEdit.nameRequired").max(100, "accountEdit.nameMax"),
  phone: z.string().trim().max(32, "accountEdit.phoneMax"),
  locale: z.enum(ACCOUNT_LOCALES, { error: "accountEdit.localeInvalid" }),
});

export type AccountValues = z.infer<typeof accountSchema>;

export const isAccountLocale = (value: string): value is AccountValues["locale"] =>
  ACCOUNT_LOCALES.some((locale) => locale === value);

export const accountValues = (user: User): AccountValues => ({
  first_name: user.first_name,
  last_name: user.last_name,
  phone: user.phone ?? "",
  locale: isAccountLocale(user.locale) ? user.locale : "kk",
});
