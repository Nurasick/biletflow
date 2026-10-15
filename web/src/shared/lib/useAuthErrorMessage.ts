import { useTranslation } from "react-i18next";

import { ApiError } from "../api/auth";

export const useAuthErrorMessage = () => {
  const { t } = useTranslation();
  return (error: unknown, fallback: string) => {
    if (!(error instanceof ApiError)) return fallback;
    if (error.status >= 500) return t("errors.unavailable");
    return error.message || fallback;
  };
};
