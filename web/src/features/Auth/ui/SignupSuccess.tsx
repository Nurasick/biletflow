import { Link } from "react-router-dom";

export const SignupSuccess = ({ email }: { email: string }) => (
  <div role="status">
    <h2 className="text-[29px] font-bold leading-[1.15] tracking-[-0.035em]">
      Your account is created
    </h2>
    <p className="mt-3 text-[12.5px] leading-[1.55] text-[#667085]">
      You registered with {email}. You can now continue to sign in.
    </p>
    <Link
      to="/login"
      className="mt-6 flex h-[47px] items-center justify-center rounded-[9px] bg-[#FF5C35] text-[13px] font-semibold text-white transition hover:bg-[#EB4E29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C35]"
    >
      Continue to sign in
    </Link>
  </div>
);
