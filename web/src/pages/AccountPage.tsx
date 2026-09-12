import { useAuth } from "../hooks/useAuth";
import { getAuthErrorMessage } from "../shared/api/auth";

export const AccountPage = () => {
  const { me, logout } = useAuth();
  const user = me.data;
  if (!user) return null;

  return (
    <main className="mx-auto w-full max-w-3xl px-7 py-12">
      <h1 className="text-3xl font-bold">Your account</h1>
      <dl className="my-8 space-y-4">
        <div><dt className="text-sm text-[#667085]">Name</dt><dd>{user.first_name} {user.last_name}</dd></div>
        <div><dt className="text-sm text-[#667085]">Email</dt><dd>{user.email}</dd></div>
      </dl>
      {logout.isError && <p role="alert" className="mb-4 text-red-600">{getAuthErrorMessage(logout.error, "Unable to sign out. Please try again.")}</p>}
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        className="rounded-xl bg-[#FF5C35] px-5 py-3 font-semibold disabled:opacity-50"
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
};
