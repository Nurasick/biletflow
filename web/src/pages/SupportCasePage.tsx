import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "antd";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";

import { OperationsError, OperationsLoading, RefreshButton } from "../features/Operations/ui/OperationsWorkspace";
import { SUPPORT_POLL_INTERVAL, supportKeys } from "../features/Support/model/supportModel";
import { CaseHeading, CaseThread } from "../features/Support/ui/SupportCaseContent";
import { SupportReplyForm } from "../features/Support/ui/SupportReplyForm";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../shared/api/auth";
import { requesterCaseHref, supportApi } from "../shared/api/support";
import { useAuthErrorMessage } from "../shared/lib/useAuthErrorMessage";

export const SupportCasePage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { caseNumber = "" } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const token = params.get("token") || null;
  const ownerId = me.data?.id ?? null;
  const created = (location.state as { caseCreated?: boolean } | null)?.caseCreated === true;

  return <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-7 sm:py-10">
    <Link to="/support" className="inline-flex items-center gap-2 text-sm font-semibold text-[#A93216] hover:underline">
      <ArrowLeft size={16} aria-hidden="true" />{t("common.help")}
    </Link>
    {token || ownerId ? <RequesterCaseView key={JSON.stringify([caseNumber, ownerId, token])}
      number={caseNumber} ownerId={ownerId} token={token} created={created} />
      : me.isPending ? <OperationsLoading />
        : me.isError ? <OperationsError error={me.error} retry={() => void me.refetch()} />
          : <Alert type="info" showIcon title={t("support.signInToView")} action={
            <Link to="/login" state={{ from: requesterCaseHref(caseNumber, null) }} className="font-semibold text-[#A93216]">
              {t("common.signIn")}
            </Link>
          } />}
  </main>;
};

const RequesterCaseView = ({ number, ownerId, token, created }: {
  number: string; ownerId: number | null; token: string | null; created: boolean;
}) => {
  const { t } = useTranslation();
  const client = useQueryClient();
  const errorMessage = useAuthErrorMessage();
  const queryKey = supportKeys.requester(number, ownerId, token);
  const reply = useMutation({
    mutationFn: (body: string) => supportApi.reply(number, token, body),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: async (updated) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, updated);
      if (ownerId) void client.invalidateQueries({ queryKey: supportKeys.mine(ownerId) });
    },
    onError: () => { void client.invalidateQueries({ queryKey }); },
  });
  const detail = useQuery({
    queryKey, queryFn: ({ signal }) => supportApi.case(number, token, signal), retry: false,
    refetchInterval: reply.isPending ? false : SUPPORT_POLL_INTERVAL, refetchOnWindowFocus: !reply.isPending,
  });
  const inaccessible = detail.error instanceof ApiError && [401, 403, 404].includes(detail.error.status);

  if (detail.isPending) return <OperationsLoading />;
  if (!detail.data || inaccessible) return <OperationsError error={detail.error} retry={() => void detail.refetch()} />;

  const supportCase = detail.data;
  return <>
    <div className="flex justify-end"><RefreshButton refresh={() => void detail.refetch()} fetching={detail.isFetching} /></div>
    <CaseHeading summary={supportCase} context={supportCase.context} />
    {created && <Alert type="success" showIcon title={t("support.created")} />}
    {token && <Alert type="info" showIcon title={t("support.keepLink")} />}
    {detail.isError && <OperationsError error={detail.error} retry={() => void detail.refetch()} />}
    <CaseThread messages={supportCase.messages} />
    {supportCase.status === "resolved" && <p className="text-sm text-[#475467]">{t("support.reopenHint")}</p>}
    {reply.isError && <Alert type="error" showIcon role="alert" title={errorMessage(reply.error, t("support.replyError"))} />}
    <SupportReplyForm busy={reply.isPending} sending={reply.isPending} onSend={async (body) => { await reply.mutateAsync(body); }} />
  </>;
};
