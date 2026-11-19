import { Link } from "react-router-dom";

type AuthSwitchLinkProps = {
  prompt: string;
  to: string;
  label: string;
};

export const AuthSwitchLink = ({ prompt, to, label }: AuthSwitchLinkProps) => (
  <span className="flex items-center gap-2">
    {prompt}
    <Link to={to} className="font-semibold text-primary hover:text-primary-hover">
      {label}
    </Link>
  </span>
);
