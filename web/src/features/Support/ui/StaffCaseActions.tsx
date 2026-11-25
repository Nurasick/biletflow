import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../../i18n/useLocale";
import { adminApi } from "../../../shared/api/admin";
import { ApiError } from "../../../shared/api/auth";
import { staffApi } from "../../../shared/api/eventManagement";
import type { StaffCase, StaffCaseStatus, StaffCaseUpdate } from "../../../shared/api/support";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";
import { OperationsError, OperationsLoading, OperationsPagination } from "../../Operations/ui/OperationsWorkspace";
import { CASE_PAGE_SIZE, ESCALATION_REASON_MAX, staffTransitions } from "../model/supportModel";

const transitionLabels: Record<StaffCaseStatus, "support.startCase" | "support.waitForRequester" | "support.resolveCase"> = {
  in_progress: "support.startCase",
  waiting_for_customer: "support.waitForRequester",
  resolved: "support.resolveCase",
};

export const StaffCaseActions = ({ supportCase, userId, busy, update, escalate }: {
  supportCase: StaffCase; userId: number; busy: boolean; update: (input: StaffCaseUpdate) => void;
  escalate: (reason: string) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const assignee = supportCase.assigned_to_user_id;
  const transitions = staffTransitions[supportCase.status];
  const assign = (id: number | null) => update({ assigned_to_user_id: id });

  return <section aria-labelledby="case-management" className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
    <h2 id="case-management" className="text-lg font-semibold">{t("support.manageCase")}</h2>
    <dl className="space-y-2 text-sm">
      <div>
        <dt className="font-semibold">{t("common.email")}</dt>
        <dd className="break-all text-muted-strong">{supportCase.contact_email}</dd>
      </div>
      <div>
        <dt className="font-semibold">{t("support.assignee")}</dt>
        <dd className="text-muted-strong">{assignee === null ? t("support.unassigned")
          : assignee === userId ? t("support.assignedToYou") : t("support.assignedId", { id: assignee })}</dd>
      </div>
    </dl>
    <div className="flex flex-wrap gap-2">
      {assignee !== userId && <Button size="small" disabled={busy} onClick={() => assign(userId)}>{t("support.assignMe")}</Button>}
      {assignee !== null && <Button size="small" disabled={busy} onClick={() => assign(null)}>{t("support.unassign")}</Button>}
    </div>
    {supportCase.audience === "organizer" && <details className="rounded-lg border border-line-soft p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t("support.findAssignee")}</summary>
      <AssigneeSearch userId={userId} assignee={assignee} busy={busy} assign={assign} />
    </details>}
    {supportCase.audience === "attendee" && supportCase.event_id !== null && <EventStaffAssignees
      eventId={supportCase.event_id} userId={userId} assignee={assignee} busy={busy} assign={assign} />}
    <Escalation supportCase={supportCase} busy={busy} escalate={escalate} />
    {transitions.length > 0 && <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
      {transitions.map((status) => <Button key={status} size="small" disabled={busy}
        onClick={() => update({ status })}>{t(transitionLabels[status])}</Button>)}
    </div>}
  </section>;
};

const AssigneeSearch = ({ userId, assignee, busy, assign }: {
  userId: number; assignee: number | null; busy: boolean; assign: (id: number) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const results = useQuery({
    queryKey: ["support", "assignees", userId, query, page],
    queryFn: ({ signal }) => adminApi.users(query, CASE_PAGE_SIZE + 1, page * CASE_PAGE_SIZE, signal),
    enabled: Boolean(query), retry: false,
  });
  const admins = results.data?.slice(0, CASE_PAGE_SIZE).filter((user) => user.is_platform_admin) ?? [];
  const hasMore = (results.data?.length ?? 0) > CASE_PAGE_SIZE;
  return <div className="mt-3 space-y-3">
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const search = draft.trim();
      if (!search || busy) return;
      if (search === query && page === 0) void results.refetch();
      else {
        setPage(0);
        setQuery(search);
      }
    }}>
      <label htmlFor="support-assignee-search" className="block text-sm">{t("support.assigneeSearch")}</label>
      <div className="flex flex-wrap gap-2">
        <Input id="support-assignee-search" type="search" maxLength={100} value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} className="min-w-32 flex-1" />
        <Button htmlType="submit" disabled={busy || !draft.trim()} loading={results.isFetching}>{t("ops.search")}</Button>
      </div>
    </form>
    {query && (results.isPending ? <OperationsLoading /> : results.isError
      ? <OperationsError error={results.error} retry={() => void results.refetch()} />
      : admins.length === 0 ? <p className="text-sm text-muted">{t("support.noAssignees")}</p>
        : <ul className="divide-y divide-line-soft">
          {admins.map((user) => <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="break-words font-semibold">{user.first_name} {user.last_name}</p>
              <p className="break-all text-xs text-muted">{user.email}</p>
            </div>
            <Button size="small" disabled={busy || assignee === user.id} onClick={() => assign(user.id)}>
              {t(assignee === user.id ? "support.alreadyAssigned" : "staff.assign")}
            </Button>
          </li>)}
        </ul>)}
    {(page > 0 || hasMore) && <OperationsPagination page={page} next={hasMore} busy={busy || results.isFetching} onPage={setPage} />}
  </div>;
};

/** Event staff the organizer assigned. Only the organizer may list them, so for
 * everyone else (staff, admins) this stays hidden and "Assign to me" remains. */
const EventStaffAssignees = ({ eventId, userId, assignee, busy, assign }: {
  eventId: number; userId: number; assignee: number | null; busy: boolean; assign: (id: number) => void;
}) => {
  const { t } = useTranslation();
  const staff = useQuery({
    queryKey: ["support", "event-staff", userId, eventId],
    queryFn: () => staffApi.list(eventId),
    retry: false,
  });
  if (staff.isError && staff.error instanceof ApiError && [403, 404].includes(staff.error.status)) return null;
  const others = staff.data?.filter((member) => member.user_id !== userId) ?? [];
  if (staff.isSuccess && others.length === 0) return null;
  return <details className="rounded-lg border border-line-soft p-3">
    <summary className="cursor-pointer text-sm font-semibold">{t("support.assignStaff")}</summary>
    <div className="mt-3">
      {staff.isPending ? <OperationsLoading /> : staff.isError
        ? <OperationsError error={staff.error} retry={() => void staff.refetch()} />
        : <ul className="divide-y divide-line-soft">
          {others.map((member) => {
            const name = `${member.first_name} ${member.last_name}`;
            return <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="break-words font-semibold">{name}</p>
                <p className="break-all text-xs text-muted">{member.email}</p>
              </div>
              <Button size="small" disabled={busy || assignee === member.user_id}
                aria-label={assignee === member.user_id ? undefined : t("support.assignTo", { name })}
                onClick={() => assign(member.user_id)}>
                {t(assignee === member.user_id ? "support.alreadyAssigned" : "staff.assign")}
              </Button>
            </li>;
          })}
        </ul>}
    </div>
  </details>;
};

const Escalation = ({ supportCase, busy, escalate }: {
  supportCase: StaffCase; busy: boolean; escalate: (reason: string) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  if (supportCase.is_escalated) {
    return <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} aria-hidden="true" />{t("support.escalated")}</p>
      {supportCase.escalated_at && <p className="mt-1 text-xs text-muted-strong">{new Intl.DateTimeFormat(locale, {
        dateStyle: "medium", timeStyle: "short",
      }).format(parseApiInstant(supportCase.escalated_at))}</p>}
      {supportCase.escalation_reason && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{supportCase.escalation_reason}</p>}
    </div>;
  }
  if (supportCase.audience !== "attendee" || supportCase.status === "resolved") return null;
  const trimmed = reason.trim();
  return <div className="border-t border-line-soft pt-4">
    <Button size="small" danger icon={<ShieldAlert size={14} aria-hidden="true" />} disabled={busy}
      onClick={() => { setModalError(null); setOpen(true); }}>{t("support.escalate")}</Button>
    <p className="mt-2 text-xs text-muted">{t("support.escalateHint")}</p>
    {open && <Modal open title={t("support.escalateTitle")} okText={t("support.escalate")} cancelText={t("ops.close")}
      okButtonProps={{ danger: true, disabled: !trimmed || trimmed.length > ESCALATION_REASON_MAX }}
      confirmLoading={sending} closable={!sending} keyboard={!sending} mask={{ closable: false }}
      cancelButtonProps={{ disabled: sending }}
      onCancel={() => { if (!sending) { setModalError(null); setOpen(false); } }}
      onOk={async () => {
        if (!trimmed || sending) return;
        setModalError(null);
        setSending(true);
        try {
          await escalate(trimmed);
          setOpen(false);
          setReason("");
        } catch (error) {
          setModalError(error instanceof Error && error.message ? error.message : t("support.escalateError"));
        } finally {
          setSending(false);
        }
      }}>
      <p className="mt-3 text-sm text-muted-strong">{t("support.escalateDescription")}</p>
      <label htmlFor={`${id}-reason`} className="mt-4 mb-1.5 block text-sm font-semibold">{t("ops.reasonRequired")}</label>
      <Input.TextArea id={`${id}-reason`} rows={3} maxLength={ESCALATION_REASON_MAX} showCount value={reason}
        disabled={sending} onChange={(event) => { setReason(event.target.value); setModalError(null); }} />
      {sending && <Alert className="mt-3" type="info" showIcon title={t("support.escalating")} />}
      {modalError && <Alert role="alert" className="mt-3" type="error" showIcon title={modalError} />}
    </Modal>}
  </div>;
};
