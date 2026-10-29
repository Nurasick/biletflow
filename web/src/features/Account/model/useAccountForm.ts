import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { authKeys } from "../../../hooks/useAuth";
import { accountApi } from "../../../shared/api/account";
import { ApiError } from "../../../shared/api/auth";
import type { User } from "../../../shared/api/auth";
import { accountSchema, accountValues, isAccountLocale } from "./accountSchema";
import type { AccountValues } from "./accountSchema";

const editableFields = ["first_name", "last_name", "phone", "locale"] as const;

export const useAccountForm = (user: User) => {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const activeSession = useRef(false);
  const request = useRef<AbortController | null>(null);
  const form = useForm<AccountValues>({
    resolver: zodResolver(accountSchema), defaultValues: accountValues(user), mode: "onBlur",
  });

  useEffect(() => {
    activeSession.current = true;
    const sessionEnded = () => { activeSession.current = false; request.current?.abort(); };
    window.addEventListener("biletflow:session-changed", sessionEnded);
    window.addEventListener("biletflow:session-ended", sessionEnded);
    return () => {
      sessionEnded();
      window.removeEventListener("biletflow:session-changed", sessionEnded);
      window.removeEventListener("biletflow:session-ended", sessionEnded);
    };
  }, []);

  const isCurrentAccount = () => activeSession.current &&
    queryClient.getQueryData<User | null>(authKeys.me)?.id === user.id;

  const onSubmit = form.handleSubmit(async (values) => {
    if (saving.current || !isCurrentAccount()) return;
    saving.current = true;
    request.current = new AbortController();
    setSaved(false);
    form.clearErrors();
    try {
      const result = await accountApi.update({ ...values, phone: values.phone || null }, request.current.signal);
      // A response from the old account must never replace a newer session.
      if (!isCurrentAccount() || result.id !== user.id) return;
      await queryClient.cancelQueries({ queryKey: authKeys.me });
      if (!isCurrentAccount()) return;
      queryClient.setQueryData<User | null>(authKeys.me, (current) =>
        current?.id === user.id ? result : current);
      form.reset(accountValues(result));
      setSaved(true);
      if (isAccountLocale(result.locale)) void i18n.changeLanguage(result.locale);
    } catch (error) {
      if (!isCurrentAccount()) return;
      let hasFieldErrors = false;
      if (error instanceof ApiError) {
        for (const field of editableFields) {
          if (error.fieldErrors[field]) {
            form.setError(field, { type: "server", message: error.fieldErrors[field] });
            hasFieldErrors = true;
          }
        }
      }
      form.setError("root", {
        type: "client",
        message: hasFieldErrors ? "accountEdit.validationError"
          : error instanceof ApiError && [401, 403].includes(error.status)
            ? "accountEdit.sessionError" : "accountEdit.saveError",
      });
    } finally {
      saving.current = false;
      request.current = null;
    }
  });

  const onChange = () => { setSaved(false); form.clearErrors("root"); };
  const onReset = () => { form.reset(); setSaved(false); };

  return { form, saved, onSubmit, onChange, onReset };
};
