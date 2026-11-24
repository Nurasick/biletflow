import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Tag } from "antd";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { operationsKeys } from "../features/Operations/model/operationsModel";
import { AdminRecordEventLink, AdminRecords, AdminRecordTime } from "../features/Operations/ui/AdminRecords";
import { OperationsError, OperationsWorkspace, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi, disputeStatuses } from "../shared/api/admin";
import type { AdminDispute, DisputeInput, DisputeStatus, DisputeUpdate } from "../shared/api/admin";
import { formatMinorCurrency } from "../shared/lib/formatPrice";
import { parseHundredths } from "../shared/lib/parseHundredths";

const NOTES_MAX = 4000;
const REASON_MAX = 2000;
const selectClass = "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const statusColors: Record<DisputeStatus, string> = {
  open: "red", under_review: "gold", resolved_organizer: "green", resolved_attendee: "blue", closed: "default",
};

export const DisputeStatusTag = ({ status }: { status: DisputeStatus }) => {
  const { t } = useTranslation();
  return <Tag color={statusColors[status]}>{t(`adminDisputes.status.${status}`)}</Tag>;
};

export const AdminDisputesPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const userId = me.data?.is_platform_admin ? me.data.id : undefined;
  if (userId === undefined) return null;

  return <OperationsWorkspace admin>
    <h1 className="page-title">{t("adminDisputes.title")}</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{t("adminDisputes.description")}</p>
    <div className="mt-6 space-y-6">
      <OpenDisputeForm userId={userId} />
      <DisputeList userId={userId} />
    </div>
  </OperationsWorkspace>;
};

const DisputeList = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const [reviewing, setReviewing] = useState<AdminDispute | null>(null);
  const status = disputeStatuses.find((value) => value === params.get("status"));
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <>
    <AdminRecords<AdminDispute> title={t("adminDisputes.list")} empty={t("adminDisputes.empty")}
      queryKey={[...operationsKeys.adminRecords(userId, "disputes"), query, status]}
      load={(page) => adminApi.disputes(page, status, query)} rowKey={(row) => row.id}
      filters={<form key={`${query}|${status ?? ""}`} className="my-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const next = new URLSearchParams(params);
        const search = String(fields.get("q") ?? "").trim();
        const selection = String(fields.get("status") ?? "");
        if (search) next.set("q", search); else next.delete("q");
        if (selection) next.set("status", selection); else next.delete("status");
        next.delete("page");
        setParams(next);
      }}>
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="admin-dispute-search" className="mb-1.5 block text-sm font-semibold">{t("adminDisputes.search")}</label>
          <Input id="admin-dispute-search" type="search" name="q" maxLength={100} defaultValue={query} />
        </div>
        <div>
          <label htmlFor="admin-dispute-status" className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
          <select id="admin-dispute-status" name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">{t("support.anyStatus")}</option>
            {disputeStatuses.map((value) => <option key={value} value={value}>{t(`adminDisputes.status.${value}`)}</option>)}
          </select>
        </div>
        <Button htmlType="submit" type="primary">{t("ops.search")}</Button>
      </form>}
      columns={[
        { label: t("adminDisputes.dispute"), cell: (row) => <>#{row.id}
          <span className="mt-1 block text-xs font-normal text-muted"><AdminRecordTime value={row.created_at} format={date} /></span></> },
        { label: t("reports.order"), cell: (row) => <><span className="block font-mono text-xs">{row.order_number}</span>
          <AdminRecordEventLink id={row.event_id} title={row.event_title} /></> },
        { label: t("support.statusLabel"), cell: (row) => <DisputeStatusTag status={row.status} /> },
        { label: t("adminFinance.amount"), cell: (row) => <span className="whitespace-nowrap font-semibold tabular-nums">
          {formatMinorCurrency(row.amount_minor, row.currency, locale)}</span> },
        { label: t("ops.reason"), cell: (row) => <span className="line-clamp-3 whitespace-pre-wrap">{row.reason}</span> },
        { label: t("adminDisputes.actions"), cell: (row) => <Button size="small"
          aria-label={t("adminDisputes.reviewLabel", { id: row.id })} onClick={() => setReviewing(row)}>
          {t("adminDisputes.review")}</Button> },
      ]} />
    {reviewing && <ReviewDispute key={reviewing.id} dispute={reviewing} userId={userId} onClose={() => setReviewing(null)} />}
  </>;
};

const ReviewDispute = ({ dispute, userId, onClose }: { dispute: AdminDispute; userId: number; onClose: () => void }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const client = useQueryClient();
  const saving = useRef(false);
  const [status, setStatus] = useState<DisputeStatus>(dispute.status);
  const [evidence, setEvidence] = useState(dispute.evidence_notes ?? "");
  const [resolution, setResolution] = useState(dispute.resolution_notes ?? "");
  const changes: DisputeUpdate = {
    ...(status !== dispute.status && { status }),
    ...(evidence.trim() !== (dispute.evidence_notes ?? "") && { evidence_notes: evidence.trim() || null }),
    ...(resolution.trim() !== (dispute.resolution_notes ?? "") && { resolution_notes: resolution.trim() || null }),
  };
  const changed = Object.keys(changes).length > 0;
  const update = useMutation({
    mutationFn: () => adminApi.updateDispute(dispute.id, changes),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: operationsKeys.adminRecords(userId, "disputes") }),
        client.invalidateQueries({ queryKey: operationsKeys.adminOverview(userId) }),
      ]);
      onClose();
    },
    onSettled: () => { saving.current = false; },
  });

  return <Modal open title={t("adminDisputes.reviewTitle", { id: dispute.id })}
    onCancel={() => { if (!saving.current) onClose(); }} closable={!update.isPending} keyboard={!update.isPending}
    mask={{ closable: false }} okText={t("organizer.save")} cancelText={t("ops.close")} confirmLoading={update.isPending}
    okButtonProps={{ disabled: !changed }} cancelButtonProps={{ disabled: update.isPending }}
    onOk={() => {
      if (!changed || saving.current) return;
      saving.current = true;
      update.mutate();
    }}>
    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted">{t("reports.order")}</dt><dd className="font-mono">{dispute.order_number}</dd></div>
      <div><dt className="text-xs text-muted">{t("adminFinance.amount")}</dt>
        <dd className="font-semibold tabular-nums">{formatMinorCurrency(dispute.amount_minor, dispute.currency, locale)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs text-muted">{t("ops.reason")}</dt>
        <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{dispute.reason}</dd></div>
    </dl>
    <div className="mt-4 space-y-4">
      <div>
        <label htmlFor={`${id}-status`} className="mb-1.5 block text-sm font-semibold">{t("support.statusLabel")}</label>
        <select id={`${id}-status`} value={status} disabled={update.isPending} className={selectClass}
          onChange={(event) => setStatus(event.target.value as DisputeStatus)}>
          {disputeStatuses.map((value) => <option key={value} value={value}>{t(`adminDisputes.status.${value}`)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-evidence`} className="mb-1.5 block text-sm font-semibold">{t("adminDisputes.evidence")}</label>
        <Input.TextArea id={`${id}-evidence`} rows={3} maxLength={NOTES_MAX} showCount value={evidence}
          disabled={update.isPending} onChange={(event) => setEvidence(event.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-resolution`} className="mb-1.5 block text-sm font-semibold">{t("adminDisputes.resolution")}</label>
        <Input.TextArea id={`${id}-resolution`} rows={3} maxLength={NOTES_MAX} showCount value={resolution}
          disabled={update.isPending} onChange={(event) => setResolution(event.target.value)} />
      </div>
      {update.isError && <OperationsError error={update.error} saving />}
    </div>
  </Modal>;
};

type DraftErrors = Partial<Record<"order" | "payment" | "amount" | "reason", true>>;

const OpenDisputeForm = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (input: DisputeInput) => adminApi.openDispute(input),
    onSuccess: async () => {
      setFormKey((key) => key + 1);
      await Promise.all([
        client.invalidateQueries({ queryKey: operationsKeys.adminRecords(userId, "disputes") }),
        client.invalidateQueries({ queryKey: operationsKeys.adminOverview(userId) }),
      ]);
    },
  });
  const describedBy = (field: keyof DraftErrors, hint?: string) =>
    [errors[field] ? `${id}-${field}-error` : null, hint].filter(Boolean).join(" ") || undefined;
  const fieldError = (field: keyof DraftErrors, key: "adminDisputes.orderRequired" | "adminDisputes.paymentInvalid"
    | "adminDisputes.amountInvalid" | "adminDisputes.reasonRequired") =>
    errors[field] && <p id={`${id}-${field}-error`} className="mt-1 text-xs text-primary-hover">{t(key)}</p>;
  const labelClass = "mb-1.5 block text-sm font-semibold";

  return <details className={operationsCard}>
    <summary className="cursor-pointer text-lg font-bold">{t("adminDisputes.open")}</summary>
    <form key={formKey} noValidate className="mt-4 space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (create.isPending) return;
      const fields = new FormData(event.currentTarget);
      const order = String(fields.get("order_number") ?? "").trim();
      const paymentText = String(fields.get("payment_id") ?? "").trim();
      const amountText = String(fields.get("amount") ?? "").trim();
      const reason = String(fields.get("reason") ?? "").trim();
      const evidence = String(fields.get("evidence") ?? "").trim();
      const payment = paymentText ? Number(paymentText) : undefined;
      const amount = amountText ? parseHundredths(amountText) : undefined;
      const next: DraftErrors = {
        ...(!order && { order: true }),
        ...(payment !== undefined && !(Number.isSafeInteger(payment) && payment > 0) && { payment: true }),
        ...((amount === null || amount === 0) && { amount: true }),
        ...(!reason && { reason: true }),
      };
      setErrors(next);
      if (Object.keys(next).length) return;
      create.mutate({
        order_number: order, reason,
        ...(payment !== undefined && { payment_id: payment }),
        ...(amount && { amount_minor: amount }),
        ...(evidence && { evidence_notes: evidence }),
      });
    }}>
      <p className="text-sm text-muted">{t("adminDisputes.openHint")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor={`${id}-order`}>{t("reports.order")}</label>
          <Input id={`${id}-order`} name="order_number" maxLength={32} required className="font-mono"
            aria-invalid={errors.order} aria-describedby={describedBy("order")} disabled={create.isPending} />
          {fieldError("order", "adminDisputes.orderRequired")}
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-payment`}>{t("adminDisputes.paymentId")}</label>
          <Input id={`${id}-payment`} name="payment_id" inputMode="numeric" maxLength={16}
            aria-invalid={errors.payment} aria-describedby={describedBy("payment")} disabled={create.isPending} />
          {fieldError("payment", "adminDisputes.paymentInvalid")}
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-amount`}>{t("adminDisputes.amount")}</label>
          <Input id={`${id}-amount`} name="amount" inputMode="decimal" maxLength={16}
            aria-invalid={errors.amount} aria-describedby={describedBy("amount", `${id}-amount-hint`)} disabled={create.isPending} />
          <p id={`${id}-amount-hint`} className="mt-1 text-xs text-muted">{t("adminDisputes.amountHint")}</p>
          {fieldError("amount", "adminDisputes.amountInvalid")}
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor={`${id}-reason`}>{t("ops.reason")}</label>
        <Input.TextArea id={`${id}-reason`} name="reason" rows={2} maxLength={REASON_MAX} required
          aria-invalid={errors.reason} aria-describedby={describedBy("reason")} disabled={create.isPending} />
        {fieldError("reason", "adminDisputes.reasonRequired")}
      </div>
      <div>
        <label className={labelClass} htmlFor={`${id}-evidence`}>{t("adminDisputes.evidence")}</label>
        <Input.TextArea id={`${id}-evidence`} name="evidence" rows={3} maxLength={NOTES_MAX} disabled={create.isPending} />
      </div>
      {create.isError && <OperationsError error={create.error} saving />}
      {create.isSuccess && <Alert type="success" showIcon role="status" title={t("adminDisputes.opened", { id: create.data.id })} />}
      <Button type="primary" htmlType="submit" loading={create.isPending}>{t("adminDisputes.submit")}</Button>
    </form>
  </details>;
};
