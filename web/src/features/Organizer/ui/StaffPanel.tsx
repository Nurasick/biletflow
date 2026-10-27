import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { ScanLine } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../../../shared/api/auth";
import { staffApi } from "../../../shared/api/eventManagement";

// §2.3 "assign check-in staff": who may scan tickets for this event in the
// mobile app. The account must exist already; they sign in to the app with it.
export const StaffPanel = ({ eventId }: { eventId: number }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["organizer", "staff", eventId];
  const staff = useQuery({ queryKey, queryFn: () => staffApi.list(eventId) });
  const [email, setEmail] = useState("");
  const assign = useMutation({
    mutationFn: () => staffApi.assign(eventId, email.trim()),
    onSuccess: (list) => { queryClient.setQueryData(queryKey, list); setEmail(""); },
  });
  const remove = useMutation({
    mutationFn: (userId: number) => staffApi.remove(eventId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const error = assign.error ?? remove.error;

  return (
    <section aria-labelledby="staff" className="rounded-xl border border-[#D0D5DD] bg-white p-5">
      <h2 id="staff" className="flex items-center gap-2 font-semibold"><ScanLine size={18} aria-hidden="true" />{t("staff.title")}</h2>
      <p className="mt-1 text-xs text-[#667085]">{t("staff.description")}</p>
      <ul className="mt-3 divide-y divide-[#EAECF0]">
        {staff.data?.map((member) => <li key={member.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 break-words">{member.first_name} {member.last_name} <span className="text-[#667085]">{member.email}</span></span>
          <Button size="small" loading={remove.isPending && remove.variables === member.user_id}
            onClick={() => remove.mutate(member.user_id)}>{t("staff.remove")}</Button>
        </li>)}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (email.trim()) assign.mutate(); }}>
        <Input type="email" aria-label={t("common.email")} placeholder={t("common.emailPlaceholder")}
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button htmlType="submit" loading={assign.isPending}>{t("staff.assign")}</Button>
      </form>
      {error && <Alert role="alert" type="error" showIcon className="mt-3"
        title={error instanceof ApiError ? error.message : t("eventWorkflow.networkError")} />}
    </section>
  );
};
