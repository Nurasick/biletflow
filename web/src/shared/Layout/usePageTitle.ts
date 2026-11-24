import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { documentTitle, pageTitleKey } from "./pageTitle";

/** Sets `document.title` to "<title> · BiletFlow" while mounted. */
export const usePageTitle = (title?: string | null) => {
  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);
};

/** Names every page after its route, in the interface language (WCAG 2.4.2 "Page Titled"). */
export const useRouteTitle = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const key = pageTitleKey(pathname);
  usePageTitle(key ? t(key) : null);
};

export const RouteTitle = () => {
  useRouteTitle();
  return null;
};
