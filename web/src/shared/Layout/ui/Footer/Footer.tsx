import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="mt-10 border-t border-[#D0D5DD] bg-[#F5F5F0]">
      <div className="mx-auto grid max-w-7xl grid-cols-4 gap-10 px-7 py-8 text-sm text-[#667085]">
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">
            <Link to="/" className="hover:text-[#FF5C35]">BiletFlow</Link>
          </h3>
          <p>{t("footer.companyLinks")}</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">{t("footer.attendees")}</h3>
          <p>{t("footer.attendeeLinks")}</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">{t("footer.organizers")}</h3>
          <p>{t("footer.organizerLinks")}</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">{t("footer.legal")}</h3>
          <p>{t("footer.legalLinks")}</p>
        </div>
      </div>
    </footer>
  );
};
