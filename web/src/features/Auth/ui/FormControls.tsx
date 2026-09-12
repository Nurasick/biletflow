import { Alert, Button } from "antd";

export const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="mt-1.5 text-[11px] text-red-600">
      {message}
    </p>
  ) : null;

export const AuthAlert = ({ message }: { message: string }) => (
  <Alert role="alert" type="error" title={message} showIcon className="mb-3" />
);

export const SubmitButton = ({
  idleLabel,
  pendingLabel,
  pending,
}: {
  idleLabel: string;
  pendingLabel: string;
  pending: boolean;
}) => (
  <Button type="primary" htmlType="submit" block loading={pending} disabled={pending}>
    {pending ? pendingLabel : idleLabel}
  </Button>
);
