import { Button, Input, Radio } from "antd";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { MESSAGE_MAX_LENGTH } from "../model/supportModel";

export const SupportReplyForm = ({ staff = false, busy, sending, onSend }: {
  staff?: boolean; busy: boolean; sending: boolean; onSend: (body: string, internal: boolean) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const submitting = useRef(false);
  const actionLabel = t(internal ? "support.addNote" : "support.sendReply");

  return <form className="space-y-3 rounded-xl border border-[#D0D5DD] bg-white p-4 sm:p-5" onSubmit={async (event) => {
    event.preventDefault();
    if (busy || submitting.current || !body.trim()) return;
    submitting.current = true;
    try {
      await onSend(body.trim(), internal);
      setBody("");
    } catch {
      // The page renders the API error. Keep the draft for retry.
    } finally {
      submitting.current = false;
    }
  }}>
    {staff && <fieldset disabled={busy}>
      <legend className="mb-2 text-sm font-semibold">{t("support.visibility")}</legend>
      <Radio.Group name={`${id}-visibility`} value={internal ? "internal" : "public"} disabled={busy}
        onChange={(event) => setInternal(event.target.value === "internal")}>
        <Radio value="public">{t("support.publicReply")}</Radio>
        <Radio value="internal">{t("support.internalNote")}</Radio>
      </Radio.Group>
      {internal && <p className="mt-2 text-xs text-[#667085]">{t("support.noteVisibility")}</p>}
    </fieldset>}
    <label htmlFor={id} className="block text-sm font-semibold">{t(internal ? "support.internalNote" : "support.message")}</label>
    <Input.TextArea id={id} value={body} onChange={(event) => setBody(event.target.value)}
      maxLength={MESSAGE_MAX_LENGTH} disabled={busy} required showCount rows={4} />
    <Button htmlType="submit" type="primary" aria-label={actionLabel} aria-busy={sending}
      loading={sending} disabled={busy || !body.trim()}>
      {actionLabel}
    </Button>
  </form>;
};
