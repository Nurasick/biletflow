import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { LoginForm } from "../features/Auth/ui/LoginForm";
import { SocialLogin } from "../features/Auth/ui/SocialLogin";

export const LoginPage = () => (
  <AuthShell
    top={<AuthSwitchLink prompt="New to BiletFlow?" to="/signup" label="Create account" />}
  >
    <AuthHeading
      eyebrow="WELCOME BACK"
      title="Sign in to your account"
      description="Access your tickets, saved events and faster checkout."
    />
    <LoginForm />
    <SocialLogin />
  </AuthShell>
);
