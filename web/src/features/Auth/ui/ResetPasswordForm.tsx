import { Alert } from "antd";
import { Link } from "react-router-dom";

import { getAuthErrorMessage } from "../../../shared/api/auth";
import { useResetPasswordForm } from "../model/useResetPasswordForm";
import { AuthField } from "./AuthField";
import { AuthAlert, SubmitButton } from "./FormControls";

export const ResetPasswordForm = ({ token }: { token: string }) => {
  const { register, errors, onSubmit, resetPassword } = useResetPasswordForm(token);

  if (resetPassword.isSuccess) {
    return (
      <Alert
        className="mt-6" role="status" type="success" showIcon
        title="Password updated"
        description="You can now sign in with your new password."
      />
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
      <AuthField
        id="reset-password" label="New password" type="password"
        autoComplete="new-password" placeholder="8+ characters"
        registration={register("password")} error={errors.password?.message}
      />
      <p className="text-xs text-[#667085]">Use 8–50 characters, with uppercase and lowercase letters and a number.</p>
      <AuthField
        id="reset-confirm-password" label="Confirm new password" type="password"
        autoComplete="new-password"
        registration={register("confirmPassword")} error={errors.confirmPassword?.message}
      />
      {resetPassword.isError && (
        <div>
          <AuthAlert message={getAuthErrorMessage(resetPassword.error, "We couldn't reset your password. Please try again.")} />
          <Link to="/forgot-password" className="text-sm font-semibold text-[#D9431F]">
            Request a new reset link
          </Link>
        </div>
      )}
      <SubmitButton idleLabel="Reset password" pendingLabel="Resetting…" pending={resetPassword.isPending} />
    </form>
  );
};
