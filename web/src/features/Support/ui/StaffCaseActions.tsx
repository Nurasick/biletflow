import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { adminApi } from "../../../shared/api/admin";
import type { StaffCase, StaffCaseStatus, StaffCaseUpdate } from "../../../shared/api/support";
import { OperationsError, OperationsLoading, OperationsPagination } from "../../Operations/ui/OperationsWorkspace";
import { CASE_PAGE_SIZE, staffTransitions } from "../model/supportModel";

const transitionLabels: Record<StaffCaseStatus, "support.startCase" | "support.waitForRequester" | "support.resolveCase"> = {
  in_progress: "support.startCase",
  waiting_for_customer: "support.waitForRequester",
  resolved: "support.resolveCase",
};

export const StaffCaseActions = ({ supportCase, userId, busy, update }: {
  supportCase: StaffCase; userId: number; busy: boolean; update: (input: StaffCaseUpdate) => void;
}) => {
  const { t } = useTranslation();
  const assignee = supportCase.assigned_to_user_id;
  const transitions = staffTransitions[supportCase.status];
  const assign = (id: number | null) => update({ assigned_to_user_id: id });

  return <section aria-labelledby="case-management" className="space-y-4 rounded-xl border border-[#D0D5DD] bg-white p-4 sm:p-5">
    <h2 id="case-management" className="text-lg font-semibold">{t("support.manageCase")}</h2>
    <dl className="space-y-2 text-sm">
      <div>
        <dt className="font-semibold">{t("common.email")}</dt>
        <dd className="break-all text-[#475467]">{supportCase.contact_email}</dd>
      </div>
      <div>
        <dt className="font-semibold">{t("support.assignee")}</dt>
        <dd className="text-[#475467]">{assignee === null ? t("support.unassigned")
          : assignee === userId ? t("support.assignedToYou") : t("support.assignedId", { id: assignee })}</dd>
      </div>
    </dl>
    <div className="flex flex-wrap gap-2">
      {assignee !== userId && <Button size="small" disabled={busy} onClick={() => assign(userId)}>{t("support.assignMe")}</Button>}
      {assignee !== null && <Button size="small" disabled={busy} onClick={() => assign(null)}>{t("support.unassign")}</Button>}
    </div>
    {supportCase.audience === "organizer" && <details className="rounded-lg border border-[#EAECF0] p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t("support.findAssignee")}</summary>
      <AssigneeSearch userId={userId} assignee={assignee} busy={busy} assign={assign} />
    </details>}
    {transitions.length > 0 && <div className="flex flex-wrap gap-2 border-t border-[#EAECF0] pt-4">
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
      : admins.length === 0 ? <p className="text-sm text-[#667085]">{t("support.noAssignees")}</p>
        : <ul className="divide-y divide-[#EAECF0]">
          {admins.map((user) => <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="break-words font-semibold">{user.first_name} {user.last_name}</p>
              <p className="break-all text-xs text-[#667085]">{user.email}</p>
            </div>
            <Button size="small" disabled={busy || assignee === user.id} onClick={() => assign(user.id)}>
              {t(assignee === user.id ? "support.alreadyAssigned" : "staff.assign")}
            </Button>
          </li>)}
        </ul>)}
    {(page > 0 || hasMore) && <OperationsPagination page={page} next={hasMore} busy={busy || results.isFetching} onPage={setPage} />}
  </div>;
};
