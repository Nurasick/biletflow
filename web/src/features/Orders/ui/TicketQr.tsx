import QRCode from "qrcode";
import { useEffect, useState } from "react";

// Draws the server-signed admission payload (qr-codes.md). High error
// correction (Q) and a 4-module quiet zone so a folded or grayscale printout
// still scans (§4.7). Pure black on white for the same reason.
export const TicketQr = ({ payload, label }: { payload: string; label: string }) => {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "Q", margin: 4, color: { dark: "#000000", light: "#ffffff" } })
      .then((markup) => { if (live) setSvg(markup); })
      .catch(() => { if (live) setSvg(null); });
    return () => { live = false; };
  }, [payload]);
  if (!svg) return <div className="aspect-square w-40 animate-pulse rounded bg-[#F5F5F0]" aria-hidden="true" />;
  // The markup is generated locally by the qrcode library from our own
  // payload, so it carries no third-party HTML.
  return <div role="img" aria-label={label} className="w-40" dangerouslySetInnerHTML={{ __html: svg }} />;
};
