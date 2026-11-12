import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsPagination, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi } from "../shared/api/admin";
import type { AdminUser } from "../shared/api/admin";
import { parseApiInstant } from "../shared/lib/parseApiInstant";

const PAGE_SIZE = 20;
const displayName = (account: AdminUser) => `${account.first_name} ${account.last_name}`;

export const AdminUsersPage = () => {
  const { me } = useAuth();
  return me.data?.is_platform_admin && <AdminUsers key={me.data.id} adminId={me.data.id} />;
};

const AdminUsers = ({ adminId }: { adminId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const client = useQueryClient();
  const [{ query, page }, setSearch] = useState({ query: "", page: 0 });
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const saving = useRef(false);
  const users = useQuery({
    queryKey: operationsKeys.adminUserList(adminId, query, page),
    queryFn: ({ signal }) => adminApi.users(query, PAGE_SIZE + 1, page * PAGE_SIZE, signal),
    retry: false,
  });
  const update = useMutation({
    mutationFn: ({ account, reason }: { account: AdminUser; reason: string }) => account.status === "active"
      ? adminApi.suspendUser(account.id, reason)
      : adminApi.reinstateUser(account.id),
    retry: false,
    onSuccess: () => setSelected(null),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: operationsKeys.adminUsers(adminId) });
      saving.current = false;
    },
  });
  const isSuspension = selected?.status === "active";
  const selectionCurrent = selected && users.data?.some((account) =>
    account.id === selected.id && account.status === selected.status);
  const reasonLength = reason.trim().length;
  const canConfirm = selectionCurrent && !update.isPending && users.isSuccess && !users.isFetching
    && (!isSuspension || (reasonLength > 0 && reasonLength <= 500));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <OperationsWorkspace admin>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{t("adminUsers.title")}</h1>
      <RefreshButton refresh={() => void users.refetch()} fetching={users.isFetching} />
    </div>
    <form className="my-6 max-w-xl space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const search = String(new FormData(event.currentTarget).get("q") ?? "").trim();
      if (search === query && page === 0) void users.refetch();
      else setSearch({ query: search, page: 0 });
    }}>
      <label htmlFor="admin-user-search" className="block text-sm font-semibold">{t("adminUsers.search")}</label>
      <div className="flex gap-2">
        <Input id="admin-user-search" name="q" type="search" maxLength={100} className="min-w-0 flex-1" />
        <Button htmlType="submit" type="primary" loading={users.isFetching}>{t("ops.search")}</Button>
      </div>
    </form>
    {update.isSuccess && <Alert className="mb-4" type="success" showIcon role="status" title={t(
      update.data.status === "suspended" ? "adminUsers.suspended" : "adminUsers.reinstated",
      { name: displayName(update.data) },
    )} />}
    {users.isPending ? <OperationsLoading /> : users.isError
      ? <OperationsError error={users.error} retry={() => void users.refetch()} />
      : users.data.length === 0 ? <p className={operationsCard}>{t("adminUsers.empty")}</p>
        : <ul className="space-y-3">
          {users.data.slice(0, PAGE_SIZE).map((account) => {
            const name = displayName(account);
            const active = account.status === "active";
            const action = active ? "adminUsers.suspend" : "adminUsers.reinstate";
            return <li key={account.id} className={operationsCard}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold">{name}</h2>
                  <p className="mt-1 break-all text-sm text-[#475467]">{account.email}</p>
                  <p className="mt-2 text-xs text-[#667085]">
                    {t("ops.created")} · <time dateTime={account.created_at}>{date.format(parseApiInstant(account.created_at))}</time>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag color={active ? "green" : "orange"}>{t(active ? "adminUsers.active" : "ops.statusSuspended")}</Tag>
                  <Tag>{t(account.is_email_verified ? "adminUsers.emailVerified" : "adminUsers.emailUnverified")}</Tag>
                  {account.is_platform_admin && <Tag>{t("adminUsers.administrator")}</Tag>}
                  {account.id !== adminId && <Button danger={active} size="small"
                    aria-label={t(active ? "adminUsers.suspendConfirm" : "adminUsers.reinstateConfirm", { name })}
                    disabled={users.isFetching || update.isPending}
                    onClick={() => { update.reset(); setSelected(account); setReason(""); }}>{t(action)}</Button>}
                </div>
              </div>
            </li>;
          })}
        </ul>}
    <OperationsPagination page={page} next={users.isSuccess && users.data.length > PAGE_SIZE}
      busy={users.isFetching || update.isPending} onPage={(next) => setSearch({ query, page: next })} />
    {selected && <Modal open
      title={t(isSuspension ? "adminUsers.suspendConfirm" : "adminUsers.reinstateConfirm", { name: displayName(selected) })}
      onCancel={() => { if (!saving.current) setSelected(null); }}
      closable={!update.isPending} keyboard={!update.isPending} mask={{ closable: false }}
      okText={t(isSuspension ? "adminUsers.suspend" : "adminUsers.reinstate")} cancelText={t("ops.close")}
      confirmLoading={update.isPending}
      okButtonProps={{ danger: isSuspension, disabled: !canConfirm }}
      cancelButtonProps={{ disabled: update.isPending }}
      onOk={() => {
        if (!canConfirm || selected.id === adminId || saving.current) return;
        saving.current = true;
        update.mutate({ account: selected, reason });
      }}>
      <p className="mt-3 break-all text-sm text-[#475467]">{selected.email}</p>
      <p className="my-4 text-sm text-[#475467]">{t(isSuspension ? "adminUsers.suspendDescription" : "adminUsers.reinstateDescription")}</p>
      {isSuspension && <div className="mb-4 space-y-2">
        <label htmlFor="admin-suspension-reason" className="block text-sm font-semibold">{t("ops.reasonRequired")}</label>
        <Input.TextArea id="admin-suspension-reason" rows={3} maxLength={500} showCount value={reason}
          disabled={update.isPending} onChange={(event) => setReason(event.target.value)} />
      </div>}
      {update.isError && <OperationsError error={update.error} saving />}
      {!update.isPending && users.isSuccess && !selectionCurrent && (
        <Alert type="warning" showIcon title={t("ops.conflict")} />
      )}
    </Modal>}
  </OperationsWorkspace>;
};
