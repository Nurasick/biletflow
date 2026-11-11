import { useMutation } from "@tanstack/react-query";
import { Button } from "antd";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuthErrorMessage } from "../lib/useAuthErrorMessage";

type Props = {
  label: string;
  accessibleLabel?: string;
  filename: string;
  getFile: () => Promise<Blob>;
};

export const FileDownloadButton = ({ label, accessibleLabel, filename, getFile }: Props) => {
  const { t } = useTranslation();
  const errorMessage = useAuthErrorMessage();
  const download = useMutation({
    mutationFn: async () => {
      const url = URL.createObjectURL(await getFile());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    },
  });

  return <div className="min-w-0">
    <Button size="small" aria-label={accessibleLabel} loading={download.isPending}
      style={{ maxWidth: "100%", height: "auto", minHeight: 24, whiteSpace: "normal" }}
      icon={<Download size={14} aria-hidden="true" />} onClick={() => download.mutate()}>
      {label}
    </Button>
    {download.isError && <p role="alert" className="mt-2 break-words text-xs text-[#A93216]">
      {errorMessage(download.error, t("files.downloadError"))}
    </p>}
  </div>;
};
