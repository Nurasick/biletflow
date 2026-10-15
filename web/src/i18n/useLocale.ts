import { useTranslation } from "react-i18next";

import { intlLocales, resolveLocale } from "./config";

export const useLocale = () => {
  const { i18n } = useTranslation();
  return intlLocales[resolveLocale(i18n.language)];
};
