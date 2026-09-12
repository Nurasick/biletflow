import { Link } from "react-router-dom";

type AuthSwitchLinkProps = {
  prompt: string;
  to: string;
  label: string;
};

export const AuthSwitchLink = ({ prompt, to, label }: AuthSwitchLinkProps) => (
  <span className="flex items-center gap-2">
    {prompt}
    <Link to={to} className="font-semibold text-[#FF5C35] hover:text-[#D9431F]">
      {label}
    </Link>
  </span>
);
