import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "antd";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";

import { OperationsError, OperationsLoading, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { SUPPORT_POLL_INTERVAL, supportKeys } from "../features/Support/model/supportModel";
import { StaffCaseActions } from "../features/Support/ui/StaffCaseActions";
import { CaseHeading, CaseThread } from "../features/Support/ui/SupportCaseContent";
import { SupportAttachments } from "../features/Support/ui/SupportAttachments";
import { SupportReplyForm } from "../features/Support/ui/SupportReplyForm";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../shared/api/auth";
import { staffSupportApi } from "../shared/api/support";
import type { StaffCaseUpdate } from "../shared/api/support";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";

type CaseAction = { kind: "reply"; body: string; internal: boolean } | { kind: "update"; input: StaffCaseUpdate }
  | { kind: "escalate"; reason: string };

const actionErrors = {
  reply: "support.replyError", update: "support.updateError", escalate: "support.escalateError",
} as const;

export const StaffSupportCasePage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { caseNumber = "" } = useParams();
  const queueSearch = (useLocation().state as { queueSearch?: string } | null)?.queueSearch;

  return <main className="min-h-[60vh] bg-paper px-4 py-8 sm:px-7 sm:py-10">
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to={{ pathname: "/staff/support", search: queueSearch ?? "" }}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary-hover hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />{t("support.queue")}
      </Link>
      {me.data && <StaffCaseView key={`${me.data.id}:${caseNumber}`} number={caseNumber} userId={me.data.id} />}
    </div>
  </main>;
};

const StaffCaseView = ({ number, userId }: { number: string; userId: number }) => {
  const { t } = useTranslation();
  const client = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const queryKey = supportKeys.staff(number, userId);
  const change = useMutation({
    mutationFn: (action: CaseAction) => action.kind === "reply"
      ? staffSupportApi.reply(number, action.body, action.internal)
      : action.kind === "escalate" ? staffSupportApi.escalate(number, action.reason)
        : staffSupportApi.update(number, action.input),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: async (updated) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, updated);
    },
    onError: () => { void client.invalidateQueries({ queryKey }); },
    onSettled: () => { void client.invalidateQueries({ queryKey: supportKeys.queue(userId) }); },
  });
  const detail = useQuery({
    queryKey, queryFn: ({ signal }) => staffSupportApi.case(number, signal), retry: false,
    refetchInterval: change.isPending ? false : SUPPORT_POLL_INTERVAL, refetchOnWindowFocus: !change.isPending,
  });
  const inaccessible = detail.error instanceof ApiError && [401, 403, 404].includes(detail.error.status);

  if (detail.isPending) return <OperationsLoading />;
  if (!detail.data || inaccessible) return <OperationsError error={detail.error} retry={() => void detail.refetch()} />;

  const supportCase = detail.data;
  return <>
    <div className="flex justify-end"><RefreshButton refresh={() => void detail.refetch()} fetching={detail.isFetching} /></div>
    <CaseHeading summary={supportCase} context={supportCase.context} />
    {detail.isError && <OperationsError error={detail.error} retry={() => void detail.refetch()} />}
    {change.isError && <Alert type="error" showIcon role="alert"
      title={errorMessage(change.error, t(actionErrors[change.variables?.kind ?? "update"]))} />}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <CaseThread messages={supportCase.messages} staff />
        <SupportReplyForm staff busy={change.isPending} sending={change.isPending && change.variables?.kind === "reply"}
          onSend={async (body, internal) => { await change.mutateAsync({ kind: "reply", body, internal }); }} />
        <SupportAttachments attachments={supportCase.attachments ?? []} scope={["staff", number, userId]}
          disabled={change.isPending}
          upload={async (file) => { await staffSupportApi.attach(number, file); await detail.refetch(); }}
          download={(attachment) => staffSupportApi.attachmentFile(number, attachment.id, attachment.content_type)} />
      </div>
      <StaffCaseActions supportCase={supportCase} userId={userId} busy={change.isPending}
        update={(input) => change.mutate({ kind: "update", input })}
        escalate={async (reason) => { await change.mutateAsync({ kind: "escalate", reason }); }} />
    </div>
  </>;
};
