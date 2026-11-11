import { Tag } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useLocale } from "../../../i18n/useLocale";
import type { CaseContext, CaseMessage, CaseStatus, CaseSummary, StaffMessage } from "../../../shared/api/support";

const statusColors: Record<CaseStatus, string> = {
  open: "blue", in_progress: "orange", waiting_for_customer: "gold", resolved: "green",
};

export const CaseStatusTag = ({ status }: { status: CaseStatus }) => {
  const { t } = useTranslation();
  return <Tag color={statusColors[status]}>{t(`support.status.${status}`)}</Tag>;
};

export const CaseRow = ({ summary, href, queueSearch, children }: {
  summary: CaseSummary; href: string; queueSearch?: string; children?: ReactNode;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  return <li>
    <Link to={href} state={queueSearch ? { queueSearch } : undefined}
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#D0D5DD] bg-white p-4 hover:border-[#FF5C35] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5C35] sm:p-5">
      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold">{t(`support.category.${summary.category}`)}</h2>
        <p className="text-xs text-[#667085]">
          <span className="font-mono">{summary.case_number}</span> · {t(`support.audience.${summary.audience}`)}
        </p>
        {children}
      </div>
      <div className="space-y-1 text-xs text-[#667085]">
        <CaseStatusTag status={summary.status} />
        <time className="block" dateTime={summary.updated_at}>{new Intl.DateTimeFormat(locale, {
          dateStyle: "medium", timeStyle: "short",
        }).format(new Date(summary.updated_at))}</time>
      </div>
    </Link>
  </li>;
};

export const CaseContextDetails = ({ context }: { context: CaseContext }) => {
  const { t } = useTranslation();
  const event = context.event_title ?? (context.event_id ? t("ops.eventId", { id: context.event_id }) : null);
  const fields = [
    { label: t("support.contextEvent"), value: event },
    { label: t("support.contextOrder"), value: context.order_number },
    { label: t("support.contextTicket"), value: context.ticket_code },
  ].filter(({ value }) => Boolean(value));
  if (fields.length === 0) return null;

  return <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-[#EAECF0] bg-white p-3 text-sm">
    {fields.map(({ label, value }) => <div key={label} className="min-w-0">
      <dt className="text-xs text-[#667085]">{label}</dt>
      <dd className="mt-0.5 [overflow-wrap:anywhere] font-semibold">{value}</dd>
    </div>)}
  </dl>;
};

export const CaseHeading = ({ summary, context }: { summary: CaseSummary; context: CaseContext }) => {
  const { t } = useTranslation();
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-mono text-xs text-[#475467]">{summary.case_number} · {t(`support.audience.${summary.audience}`)}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{t(`support.category.${summary.category}`)}</h1>
      </div>
      <CaseStatusTag status={summary.status} />
    </div>
    <CaseContextDetails context={context} />
  </div>;
};

const internalNote = (message: CaseMessage | StaffMessage) =>
  "is_internal_note" in message && message.is_internal_note;

export const CaseThread = ({ messages, staff = false }: {
  messages: (CaseMessage | StaffMessage)[]; staff?: boolean;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <section aria-labelledby="support-conversation">
    <h2 id="support-conversation" className="text-lg font-semibold">{t("support.conversation")}</h2>
    <ol className="mt-3 space-y-3">
      {messages.filter((message) => staff || !internalNote(message)).map((message) => <li key={message.id}
        className={`rounded-xl border p-4 ${internalNote(message) ? "border-[#F5D787] bg-[#FFFAEB]"
          : message.sender === "system" ? "border-[#EAECF0] bg-[#F5F5F0]" : "border-[#D0D5DD] bg-white"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-[#344054]">{t(internalNote(message) ? "support.internalNote" : `support.sender.${message.sender}`)}</span>
          <time className="text-[#667085]" dateTime={message.created_at}>{date.format(new Date(message.created_at))}</time>
        </div>
        <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6">{message.body}</p>
      </li>)}
    </ol>
  </section>;
};
