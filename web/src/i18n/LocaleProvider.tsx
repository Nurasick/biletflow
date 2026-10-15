import { ConfigProvider } from "antd";
import en from "antd/locale/en_GB";
import kk from "antd/locale/kk_KZ";
import ru from "antd/locale/ru_RU";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { resolveLocale } from "./config";

const componentLocales = { kk, ru, en };

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation();
  return <ConfigProvider locale={componentLocales[resolveLocale(i18n.language)]}>{children}</ConfigProvider>;
};
