import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export const NotFoundPage = () => {
  const { t } = useTranslation();

  return (
    <main className="site-container py-14 sm:py-22">
      <section className="panel mx-auto max-w-xl px-5 py-9 text-center sm:p-12">
        <p className="text-sm font-bold text-primary">404</p>
        <h1 className="page-title mt-2">{t("booking.pageNotFound")}</h1>
        <p className="mt-3 text-sm text-muted">{t("booking.pageNotFoundDescription")}</p>
        <Link to="/" className="action-button action-button--primary mt-6">{t("catalogue.browse")}</Link>
      </section>
    </main>
  );
};
