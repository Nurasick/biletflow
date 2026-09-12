import { useState } from "react";

import { AuthHeading } from "../features/Auth/ui/AuthHeading";
import { AuthShell } from "../features/Auth/ui/AuthShell";
import { AuthSwitchLink } from "../features/Auth/ui/AuthSwitchLink";
import { SignupForm } from "../features/Auth/ui/SignupForm";
import { SignupSuccess } from "../features/Auth/ui/SignupSuccess";

export const SignupPage = () => {
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  return (
    <AuthShell
      top={<AuthSwitchLink prompt="Already have an account?" to="/login" label="Sign in" />}
    >
      {registeredEmail ? (
        <SignupSuccess email={registeredEmail} />
      ) : (
        <>
          <AuthHeading
            eyebrow="JOIN BILETFLOW"
            title="Create your account"
            description="One account for tickets, saved events and quicker checkout."
          />
          <SignupForm onSuccess={setRegisteredEmail} />
        </>
      )}
    </AuthShell>
  );
};
