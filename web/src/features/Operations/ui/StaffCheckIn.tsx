import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Tag } from "antd";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { checkInApi } from "../../../shared/api/staff";
import type { ScanResponse, ScannedTicket } from "../../../shared/api/staff";
import { operationsKeys, ticketAction } from "../model/operationsModel";
import { CameraScanner } from "./CameraScanner";
import { OperationsError, OperationsLoading, operationsCard } from "./OperationsWorkspace";

type TicketAction = { kind: "admit" | "reverse"; ticket: ScannedTicket };
type DoorAction = TicketAction | { kind: "scan"; qr: string };
type DoorResult = { kind: "scan" | "admit"; response: ScanResponse } | { kind: "reverse"; ticket: ScannedTicket };

const outcomeLabels = {
  valid: "ops.outcomeValid", invalid: "ops.outcomeInvalid", wrong_event: "ops.outcomeWrongEvent",
  cancelled: "ops.outcomeCancelled", refunded: "ops.outcomeRefunded", already_used: "ops.outcomeAlreadyUsed",
} as const;
const ticketStatusLabels = {
  valid: "ops.ticketValid", checked_in: "ops.ticketCheckedIn", cancelled: "ops.ticketCancelled", refunded: "ops.ticketRefunded",
} as const;

const TicketIdentity = ({ ticket }: { ticket: ScannedTicket }) => <div className="min-w-0">
  <p className="break-words font-semibold">{ticket.attendee_name}</p>
  <p className="mt-1 break-words text-sm text-[#667085]">{ticket.ticket_type_name}</p>
  <p className="mt-1 break-all font-mono text-sm">{ticket.public_code}</p>
</div>;

export const StaffCheckIn = ({ eventId, userId, ready }: { eventId: number; userId?: number; ready: boolean }) => {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [qr, setQr] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmation, setConfirmation] = useState<TicketAction | null>(null);
  const [result, setResult] = useState<DoorResult | null>(null);
  const [inputError, setInputError] = useState(false);
  const search = useQuery({
    queryKey: operationsKeys.ticketSearch(userId, eventId, searchQuery),
    queryFn: ({ signal }) => checkInApi.search(eventId, searchQuery, signal),
    enabled: Boolean(userId) && ready && searchQuery.length >= 2,
    retry: false,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: operationsKeys.attendance(userId, eventId) }),
      client.invalidateQueries({ queryKey: operationsKeys.ticketSearches(userId, eventId) }),
    ]);
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: async (action: DoorAction): Promise<DoorResult> => {
      const deviceInfo = navigator.userAgent.slice(0, 200);
      if (action.kind === "scan") return { kind: "scan", response: await checkInApi.scan(eventId, action.qr, deviceInfo) };
      if (action.kind === "admit") return { kind: "admit", response: await checkInApi.admit(eventId, action.ticket.public_code, deviceInfo) };
      return { kind: "reverse", ticket: await checkInApi.reverse(eventId, action.ticket.public_code, deviceInfo) };
    },
    onSuccess: (response) => { setResult(response); setQr(""); setConfirmation(null); },
    // A network failure can follow a committed check-in. Re-read rather than
    // automatically retrying admission or presenting stale ticket actions.
    onSettled: refresh,
  });
  const submitQr = useCallback((value: string) => {
    if (!ready || mutation.isPending) return;
    if (!value.trim() || value.length > 512) { setInputError(true); return; }
    setInputError(false);
    setResult(null);
    mutation.mutate({ kind: "scan", qr: value.trim() });
  }, [ready, mutation]);
  const busy = mutation.isPending;
  const disabled = !ready || busy;
  const selectedTicket = result?.kind === "reverse" ? result.ticket : result?.response.ticket;

  return <div className="grid items-start gap-6 lg:grid-cols-2">
    <section className={operationsCard}>
      <h2 className="text-xl font-bold">{t("ops.scanTitle")}</h2>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{t("ops.scanHint")}</p>
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); submitQr(qr); }}>
        <label htmlFor="ticket-qr" className="block text-sm font-semibold">{t("ops.qrLabel")}</label>
        <Input.TextArea id="ticket-qr" value={qr} onChange={(event) => { setQr(event.target.value); setInputError(false); }}
          rows={3} maxLength={512} disabled={disabled} placeholder={t("ops.qrPlaceholder")} autoComplete="off" />
        {inputError && <p role="alert" className="text-sm text-red-700">{t("ops.invalidInput")}</p>}
        <Button htmlType="submit" type="primary" block disabled={disabled || !qr.trim()} loading={busy && mutation.variables?.kind === "scan"}>{t("ops.scan")}</Button>
      </form>
      <CameraScanner disabled={disabled} onQr={submitQr} />
      <div className="mt-5 space-y-4" aria-live="polite" aria-atomic="true">
        {mutation.isError && <OperationsError saving error={mutation.error} />}
        {result && <Alert showIcon type={result.kind === "reverse" || result.response.outcome === "valid" ? "success" : "error"}
          title={t(result.kind === "reverse" ? "ops.reversed" : outcomeLabels[result.response.outcome])}
          description={selectedTicket && <TicketIdentity ticket={selectedTicket} />} />}
      </div>
    </section>
    <section className={operationsCard}>
      <h2 className="text-xl font-bold">{t("ops.searchAttendees")}</h2>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{t("ops.attendeeSearchHint")}</p>
      <form className="mt-4 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        const value = searchDraft.trim();
        if (disabled || value.length < 2 || value.length > 100) return;
        if (value === searchQuery) void search.refetch();
        else setSearchQuery(value);
      }}>
        <label htmlFor="attendee-search" className="block text-sm font-semibold">{t("ops.attendeeSearchLabel")}</label>
        <div className="flex flex-wrap gap-2"><Input id="attendee-search" type="search" value={searchDraft} maxLength={100}
          onChange={(event) => setSearchDraft(event.target.value)} disabled={disabled} className="min-w-0 flex-1" />
          <Button htmlType="submit" disabled={disabled || searchDraft.trim().length < 2} loading={search.isFetching}>{t("ops.search")}</Button></div>
      </form>
      {searchQuery && <div className="mt-5">
        {search.isPending ? <OperationsLoading /> : search.isError ? <OperationsError error={search.error} retry={() => void search.refetch()} />
          : search.data?.length === 0 ? <p role="status" className="text-sm text-[#667085]">{t("ops.searchEmpty")}</p>
            : <ul className="divide-y divide-[#EAECF0]">
              {search.data?.map((ticket) => {
                const action = ticketAction(ticket);
                return <li key={ticket.public_code} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <TicketIdentity ticket={ticket} />
                  <div className="flex flex-col items-start gap-2">
                    <Tag color={ticket.status === "checked_in" ? "green" : ticket.status === "valid" ? "blue" : "red"}>
                      {t(ticketStatusLabels[ticket.status as keyof typeof ticketStatusLabels] ?? "ops.statusUnknown")}
                    </Tag>
                    {action && <Button size="small" disabled={disabled || search.isFetching || search.isError}
                      onClick={() => { mutation.reset(); setConfirmation({ kind: action, ticket }); }}>
                      {t(action === "admit" ? "ops.admit" : "ops.reverse")}
                    </Button>}
                  </div>
                </li>;
              })}
            </ul>}
        {search.data?.length === 25 && <p className="mt-3 text-xs leading-5 text-[#667085]">{t("ops.searchMore")}</p>}
      </div>}
    </section>
    <Modal open={Boolean(confirmation)} title={confirmation && t(confirmation.kind === "admit" ? "ops.admitConfirm" : "ops.reverseConfirm", { name: confirmation.ticket.attendee_name })}
      onCancel={() => { if (!busy) setConfirmation(null); }} closable={!busy} maskClosable={!busy}
      okText={t("ops.confirm")} cancelText={t("ops.close")} confirmLoading={busy} cancelButtonProps={{ disabled: busy }}
      okButtonProps={{ disabled: disabled || search.isFetching || search.isError }}
      onOk={() => { if (confirmation && !disabled && !search.isFetching && !search.isError) mutation.mutate(confirmation); }}>
      {confirmation && <p className="py-4 text-sm leading-6">{t(confirmation.kind === "admit" ? "ops.admitDescription" : "ops.reverseDescription", { code: confirmation.ticket.public_code })}</p>}
      {mutation.isError && <OperationsError saving error={mutation.error} />}
    </Modal>
  </div>;
};
