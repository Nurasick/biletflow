import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

export const MAIN_CONTENT_ID = "main-content";

/** Moves focus past the header and navigation to the page's main landmark
 * (WCAG 2.4.1 "Bypass Blocks"). Visible only while focused. */
export const SkipLink = () => {
  const { t } = useTranslation();
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector<HTMLElement>("main") ?? document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: "start" });
  };
  return <a href={`#${MAIN_CONTENT_ID}`} onClick={skip}
    className="sr-only rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[1100] focus:outline-2 focus:outline-offset-2 focus:outline-primary">
    {t("a11y.skipToContent")}
  </a>;
};
