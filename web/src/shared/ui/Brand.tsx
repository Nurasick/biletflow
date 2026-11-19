import { ScanLine, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function Brand() {
  const { t } = useTranslation();
  return (
    <Link to="/" aria-label={`BiletFlow · ${t("common.home")}`} className="brand-link">
      <span className="brand-mark"><Ticket size={21} strokeWidth={2.3} aria-hidden="true" /></span>
      <span>BiletFlow</span>
    </Link>
  );
}

export function BrandTicket() {
  return (
    <div className="brand-ticket" aria-hidden="true">
      <div className="brand-ticket__face">
        <Ticket className="size-[1.55em]" strokeWidth={1.65} />
        <span>BiletFlow</span>
      </div>
      <div className="brand-ticket__stub"><ScanLine className="size-6 opacity-70 sm:size-9" strokeWidth={1.5} /></div>
    </div>
  );
}
