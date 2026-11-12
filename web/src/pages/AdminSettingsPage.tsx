import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { platformFeeLimits, readFeeDraft } from "../features/Operations/model/adminSettingsModel";
import type { FeeDraft } from "../features/Operations/model/adminSettingsModel";
import { operationsKeys } from "../features/Operations/model/operationsModel";
import { OperationsError, OperationsLoading, OperationsWorkspace, RefreshButton, operationsCard } from "../features/Operations/ui/OperationsWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useLocale } from "../i18n/useLocale";
import { adminApi } from "../shared/api/admin";
import { formatMinor } from "../shared/lib/formatPrice";
import { useUnsavedChanges } from "../shared/lib/useUnsavedChanges";

const fields = [
  { field: "activation_fee_minor", label: "adminSettings.activationFee" },
  { field: "processing_fee_bps", label: "adminSettings.processingFee" },
] as const;

export const AdminSettingsPage = () => {
  const { me } = useAuth();
  return me.data?.is_platform_admin && <AdminSettingsForm key={me.data.id} userId={me.data.id} />;
};

const AdminSettingsForm = ({ userId }: { userId: number }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const client = useQueryClient();
  const queryKey = operationsKeys.adminSettings(userId);
  const [draft, setDraft] = useState<FeeDraft>({});
  const saving = useRef(false);
  const settings = useQuery({ queryKey, queryFn: ({ signal }) => adminApi.settings(signal), retry: false });
  const update = useMutation({
    mutationFn: adminApi.updateSettings,
    retry: false,
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, saved);
      setDraft({});
    },
    onSettled: () => { saving.current = false; },
  });
  const savedSettings = settings.data;
  const { changes, invalid, dirty } = readFeeDraft(draft, savedSettings);
  const blocker = useUnsavedChanges(dirty || update.isPending);
  const canSave = dirty && invalid.length === 0 && settings.isSuccess && !settings.isFetching && !update.isPending;
  const decimal = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 });
  const maxRate = new Intl.NumberFormat(locale, { style: "percent" }).format(platformFeeLimits.processing_fee_bps / 10_000);
  const refresh = () => void settings.refetch();

  return <OperationsWorkspace admin>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{t("adminSettings.title")}</h1>
      <RefreshButton refresh={refresh} fetching={settings.isFetching} disabled={update.isPending} />
    </div>
    {settings.isPending && <OperationsLoading />}
    {settings.isError && <div className="mb-4"><OperationsError error={settings.error} retry={refresh} /></div>}
    {savedSettings && <form noValidate className={`${operationsCard} max-w-2xl space-y-5`} onSubmit={(event) => {
      event.preventDefault();
      if (!canSave || saving.current) return;
      saving.current = true;
      update.mutate(changes);
    }}>
      <p className="text-sm leading-6 text-[#475467]">{t("adminSettings.description")}</p>
      <fieldset disabled={update.isPending} className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ field, label }) => {
          const hasError = invalid.includes(field);
          const id = `platform-${field}`;
          return <div key={field}>
            <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{t(label)}</label>
            <Input id={id} inputMode="decimal" required value={draft[field] ?? decimal.format(savedSettings[field] / 100)}
              aria-invalid={hasError} aria-describedby={hasError ? `${id}-error` : undefined}
              status={hasError ? "error" : undefined} onChange={(event) => {
                const value = event.target.value;
                update.reset();
                setDraft((current) => ({ ...current, [field]: value }));
              }} />
            {hasError && <p id={`${id}-error`} className="mt-2 text-xs text-[#A93216]">
              {t("adminSettings.range", {
                max: field === "processing_fee_bps" ? maxRate : formatMinor(platformFeeLimits.activation_fee_minor, locale),
              })}
            </p>}
          </div>;
        })}
      </fieldset>
      {update.isSuccess && <Alert role="status" type="success" showIcon title={t("adminSettings.saved")} />}
      {update.isError && <OperationsError error={update.error} saving />}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#D0D5DD] pt-4">
        <Button disabled={!dirty || update.isPending} onClick={() => { setDraft({}); update.reset(); }}>
          {t("accountEdit.discard")}
        </Button>
        <Button type="primary" htmlType="submit" loading={update.isPending} disabled={!canSave}>{t("accountEdit.save")}</Button>
      </div>
    </form>}
    <Modal open={blocker.state === "blocked"} title={t("adminSettings.discardTitle")}
      okText={t("accountEdit.leave")} cancelText={t("accountEdit.keepEditing")}
      okButtonProps={{ danger: true, disabled: update.isPending }}
      onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}
      onOk={() => { if (blocker.state === "blocked" && !update.isPending) blocker.proceed(); }} />
  </OperationsWorkspace>;
};
