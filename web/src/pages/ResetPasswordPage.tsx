import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";

export const ResetPasswordPage = () => (
  <AuthShell top={<AuthSwitchLink prompt="Back to your account" to="/login" label="Sign in" />}>
    <AuthHeading
      eyebrow="ACCOUNT RECOVERY"
      title="Password recovery is coming soon"
      description="Password reset is not available yet. Please sign in with your existing password."
    />
  </AuthShell>
);
