import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { Flag } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../../../shared/api/auth";
import { eventReportReasons, eventsApi } from "../../../shared/api/events";
import type { EventReportReason } from "../../../shared/api/events";

export const ReportEventButton = ({ slug, title }: { slug: string; title: string }) => {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);

  return <>
    <Button size="small" icon={<Flag size={14} aria-hidden="true" />}
      onClick={(event) => setTrigger(event.currentTarget)}>{t("eventReport.report")}</Button>
    {trigger && <ReportEventDialog slug={slug} title={title} onClose={() => {
      setTrigger(null);
      requestAnimationFrame(() => trigger.focus());
    }} />}
  </>;
};

const ReportEventDialog = ({ slug, title, onClose }: { slug: string; title: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState<EventReportReason | "">("");
  const [details, setDetails] = useState("");
  const submitting = useRef(false);
  const report = useMutation({
    mutationFn: ({ reason, details }: { reason: EventReportReason; details: string }) => eventsApi.report(slug, reason, details),
    retry: false,
    onSettled: () => { submitting.current = false; },
  });

  return <Modal open footer={null} title={t("eventReport.report")}
    closable={!report.isPending} keyboard={!report.isPending} mask={{ closable: false }}
    onCancel={() => { if (!submitting.current) onClose(); }}>
    <p className="my-4 break-words text-sm font-semibold text-[#475467]">{title}</p>
    {report.isSuccess ? <div className="space-y-4">
      <Alert type="success" showIcon role="status" title={t("eventReport.submitted")} />
      <div className="flex justify-end"><Button onClick={onClose}>{t("ops.close")}</Button></div>
    </div> : <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (!reason || submitting.current) return;
      submitting.current = true;
      report.mutate({ reason, details });
    }}>
      <div>
        <label htmlFor={`${id}-reason`} className="mb-1.5 block text-sm font-semibold">{t("ops.reason")}</label>
        <select id={`${id}-reason`} required value={reason} disabled={report.isPending}
          onChange={(event) => setReason(event.target.value as EventReportReason | "")}
          className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm disabled:opacity-60">
          <option value="" disabled>{t("eventReport.chooseReason")}</option>
          {eventReportReasons.map((value) => <option key={value} value={value}>{t(`eventReport.reason.${value}`)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-details`} className="mb-1.5 block text-sm font-semibold">{t("eventReport.optionalDetails")}</label>
        <Input.TextArea id={`${id}-details`} rows={4} maxLength={1000} showCount disabled={report.isPending}
          value={details} onChange={(event) => setDetails(event.target.value)} />
      </div>
      {report.isError && <Alert type="error" showIcon role="alert" title={t(
        report.error instanceof ApiError && report.error.status === 404 ? "eventWorkflow.notFound" : "eventReport.submitError",
      )} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={report.isPending}>{t("ops.close")}</Button>
        <Button htmlType="submit" type="primary" disabled={!reason} loading={report.isPending}>{t("eventReport.submit")}</Button>
      </div>
    </form>}
  </Modal>;
};
