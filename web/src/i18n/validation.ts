import type { TFunction } from "i18next";

import en from "./locales/en.json";

// Keep message identifiers in client schemas so existing errors change language
// immediately. Server validation messages pass through exactly as received.
export const validationMessage = (
  t: TFunction,
  error?: { message?: string; type?: string | number },
) => {
  const message = error?.message;
  if (
    error?.type !== "server" && message &&
    (error?.type === "client" || message.startsWith("validation.")) &&
    Object.hasOwn(en, message)
  ) {
    return t(message as keyof typeof en);
  }
  return message;
};
