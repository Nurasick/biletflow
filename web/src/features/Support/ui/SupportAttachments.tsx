import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import { FileText, Paperclip } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES } from "../../../shared/api/support";
import type { AttachmentUpload, CaseAttachment } from "../../../shared/api/support";
import { useAuthErrorMessage } from "../../../shared/lib/useAuthErrorMessage";
import { FileDownloadButton } from "../../../shared/ui/FileDownloadButton";
import { attachmentProblem } from "../model/supportModel";
import type { AttachmentProblem } from "../model/supportModel";

type Props = {
  attachments: CaseAttachment[];
  /** Cache scope for previews, e.g. the case number and viewer. */
  scope: readonly unknown[];
  disabled?: boolean;
  upload: (file: AttachmentUpload) => Promise<unknown>;
  download: (attachment: CaseAttachment) => Promise<Blob>;
};

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unreadable file"));
  reader.onerror = () => reject(reader.error ?? new Error("Unreadable file"));
  reader.readAsDataURL(file);
});

export const SupportAttachments = ({ attachments, scope, disabled = false, upload, download }: Props) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const errorMessage = useAuthErrorMessage();
  const [problem, setProblem] = useState<AttachmentProblem | null>(null);
  const send = useMutation({
    mutationFn: async (file: File) => upload({ filename: file.name.slice(0, 255), dataUrl: await readAsDataUrl(file) }),
    onSettled: () => { if (input.current) input.current.value = ""; },
  });
  const maxMb = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ATTACHMENT_MAX_BYTES / (1024 * 1024));

  return <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-line bg-white p-4 sm:p-5">
    <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-semibold">
      <Paperclip size={18} aria-hidden="true" />{t("support.attachments")}
    </h2>
    {attachments.length === 0 ? <p className="text-sm text-muted">{t("support.noAttachments")}</p>
      : <ul className="grid gap-3 sm:grid-cols-2">
        {attachments.map((attachment) => <AttachmentItem key={attachment.id} attachment={attachment} scope={scope} download={download} />)}
      </ul>}
    <div className="border-t border-line-soft pt-3">
      <label htmlFor={`${id}-file`} className="block text-sm font-semibold">{t("support.addAttachment")}</label>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{t("support.attachmentHint", { size: maxMb })}</p>
      <input ref={input} id={`${id}-file`} type="file" accept={ATTACHMENT_TYPES.join(",")}
        disabled={disabled || send.isPending} aria-describedby={`${id}-hint${problem || send.isError ? ` ${id}-error` : ""}`}
        className="mt-2 block w-full max-w-full text-sm file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:font-semibold"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setProblem(null);
          send.reset();
          if (!file) return;
          const issue = attachmentProblem(file);
          if (issue) { setProblem(issue); event.target.value = ""; return; }
          send.mutate(file);
        }} />
      <div id={`${id}-error`} aria-live="polite" className="mt-2">
        {send.isPending && <p role="status" className="text-sm text-muted">{t("support.uploading")}</p>}
        {problem && <Alert type="error" showIcon title={t(problem, { size: maxMb })} />}
        {send.isError && !problem && <Alert type="error" showIcon title={errorMessage(send.error, t("support.attachmentError"))} />}
        {send.isSuccess && <p role="status" className="text-sm text-muted-strong">{t("support.attachmentAdded")}</p>}
      </div>
    </div>
  </section>;
};

const AttachmentItem = ({ attachment, scope, download }: {
  attachment: CaseAttachment; scope: readonly unknown[]; download: (attachment: CaseAttachment) => Promise<Blob>;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const image = attachment.content_type.startsWith("image/");
  const size = new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 })
    .format(Math.max(1, attachment.size_bytes / 1024));
  return <li className="flex min-w-0 gap-3 rounded-lg border border-line-soft p-3">
    {image ? <ImagePreview attachment={attachment} scope={scope} download={download} />
      : <span className="grid size-16 shrink-0 place-items-center rounded-md bg-paper text-muted" aria-hidden="true"><FileText size={24} /></span>}
    <div className="min-w-0 flex-1 space-y-2">
      <p className="break-all text-sm font-semibold">{attachment.filename}</p>
      <p className="text-xs text-muted">{size}</p>
      <FileDownloadButton filename={attachment.filename} label={t("support.downloadAttachment")}
        accessibleLabel={t("support.downloadAttachmentFor", { name: attachment.filename })} getFile={() => download(attachment)} />
    </div>
  </li>;
};

const ImagePreview = ({ attachment, scope, download }: {
  attachment: CaseAttachment; scope: readonly unknown[]; download: (attachment: CaseAttachment) => Promise<Blob>;
}) => {
  const { t } = useTranslation();
  // A data URL needs no revoking, and attachments are capped at a few megabytes.
  const preview = useQuery({
    queryKey: ["support", "attachment", ...scope, attachment.id],
    queryFn: async () => readAsDataUrl(await download(attachment)),
    staleTime: Infinity, retry: false,
  });
  return preview.data
    ? <img src={preview.data} alt={t("support.attachmentPreview", { name: attachment.filename })}
      className="size-16 shrink-0 rounded-md border border-line-soft object-cover" />
    : <span className="grid size-16 shrink-0 place-items-center rounded-md bg-paper text-xs text-muted" aria-hidden="true">
      {preview.isError ? "—" : "…"}
    </span>;
};
