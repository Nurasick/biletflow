import { ConfigProvider } from "antd";
import en from "antd/locale/en_GB";
import kk from "antd/locale/kk_KZ";
import ru from "antd/locale/ru_RU";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { resolveLocale } from "./config";

const componentLocales = { kk, ru, en };

const theme = {
  token: {
    fontFamily: 'Onest, "Segoe UI", system-ui, sans-serif',
    colorPrimary: "#593bc9",
    colorText: "#1c1830",
    colorTextSecondary: "#615d73",
    colorBgLayout: "#f7f7f2",
    colorBorder: "#dad8e3",
    colorSplit: "#eae8f0",
    borderRadius: 10,
    controlHeight: 44,
  },
  components: {
    Button: { fontWeight: 650, primaryShadow: "none", defaultShadow: "none" },
    Table: { headerBg: "#f0eff6", rowHoverBg: "#f7f5ff" },
  },
};

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation();
  return <ConfigProvider locale={componentLocales[resolveLocale(i18n.language)]} theme={theme}>{children}</ConfigProvider>;
};
