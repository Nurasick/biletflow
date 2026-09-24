import { Alert, Button, ConfigProvider } from "antd";
import { ArrowLeft, BadgeCheck, LoaderCircle, UserRound } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";

import { useOrganizerProfile } from "../features/Organizer/model/useOrganizerProfile";
import { OrganizerProfileForm } from "../features/Organizer/ui/OrganizerProfileForm";

export const OrganizerProfilePage = () => {
  const { userId } = useOutletContext<{ userId: number }>();
  const { profile, saveProfile } = useOrganizerProfile(userId);

  return (
    <ConfigProvider theme={{ token: {
      colorPrimary: "#FF5C35", colorText: "#101828", colorBgContainer: "#F5F5F0",
      colorBorder: "#D0D5DD", borderRadius: 9, controlHeight: 44, fontSize: 13,
    }, components: { Button: { primaryColor: "#101828" } } }}>
      <div className="min-h-screen bg-[#F5F5F0] text-[#101828]">
        <header className="border-b border-[#D0D5DD] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-8">
            <Link to="/" aria-label="BiletFlow home" className="text-2xl font-bold tracking-tight">Bilet<span className="text-[#FF5C35]">Flow</span></Link>
            <span className="rounded-full border border-[#D0D5DD] px-3 py-1.5 text-xs text-[#667085]">Organizer workspace</span>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:py-10">
          <aside>
            <Link to="/" className="flex items-center gap-2 text-xs text-[#667085]"><ArrowLeft size={14} aria-hidden="true" />Back to events</Link>
            <nav aria-label="Organizer navigation" className="mt-6">
              <Link to="/organizer/profile" aria-current="page" className="flex items-center gap-3 rounded-lg bg-[#FF5C35]/10 px-4 py-3 text-sm font-semibold text-[#A93216]">
                <UserRound size={18} aria-hidden="true" />Organizer profile
              </Link>
            </nav>
            <div className="mt-6 hidden rounded-xl border border-[#D0D5DD] p-4 lg:block">
              <BadgeCheck size={20} className="text-[#667085]" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold">Make it easy to get in touch</p>
              <p className="mt-2 text-xs leading-5 text-[#667085]">Keep your contact details current so attendees can reach the right people.</p>
            </div>
          </aside>
          <main className="min-w-0 max-w-4xl">
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#667085]">YOUR ORGANIZATION</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Organizer profile</h1>
            <p className="mt-2 text-sm leading-6 text-[#667085]">Manage your public details, contact information and payout simulation.</p>
            <div className="my-6 rounded-lg border border-[#D0D5DD] px-4 py-3 text-xs leading-5 text-[#667085]">
              <span className="font-semibold text-[#101828]">Demo workspace.</span> Changes are saved in this browser. Use sample contact and payout details.
            </div>
            {profile.isPending ? (
              <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white py-20 text-sm text-[#667085]">
                <LoaderCircle className="animate-spin text-[#FF5C35]" size={18} aria-hidden="true" />Loading your profile…
              </div>
            ) : profile.isError ? (
              <Alert role="alert" type="error" showIcon title="Unable to load your profile" description={profile.error.message}
                action={<Button onClick={() => void profile.refetch()} loading={profile.isFetching}>Try again</Button>} />
            ) : (
              <OrganizerProfileForm profile={profile.data} saveProfile={saveProfile.mutateAsync} />
            )}
            <p className="mt-8 text-xs text-[#667085]">* Required fields</p>
          </main>
        </div>
      </div>
    </ConfigProvider>
  );
};
