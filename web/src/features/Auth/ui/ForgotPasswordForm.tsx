import { Alert, Button } from "antd";

import { getAuthErrorMessage } from "../../../shared/api/auth";
import { useForgotPasswordForm } from "../model/useForgotPasswordForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const ForgotPasswordForm = () => {
  const { register, errors, onSubmit, forgotPassword } = useForgotPasswordForm();

  if (forgotPassword.isSuccess) {
    return (
      <div className="mt-6">
        <Alert
          role="status" type="success" showIcon title="Check your email"
          description="If an account exists for that email address, you’ll receive a password reset link. Check your spam folder too."
        />
        <Button className="mt-4" block onClick={() => forgotPassword.reset()}>
          Try another email
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
      <AuthField
        id="forgot-email" label="Email address" type="email"
        autoComplete="email" placeholder="you@example.com"
        registration={register("email")} error={errors.email?.message}
      />
      {forgotPassword.isError && (
        <AuthAlert message={getAuthErrorMessage(forgotPassword.error, "We couldn't send the reset link. Please try again.")} />
      )}
      <SubmitButton idleLabel="Send reset link" pendingLabel="Sending…" pending={forgotPassword.isPending} />
    </form>
  );
};
