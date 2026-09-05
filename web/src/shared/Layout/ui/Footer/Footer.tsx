export const Footer = () => {
  return (
    <footer className="mt-10 border-t border-[#D0D5DD] bg-[#F5F5F0]">
      <div className="mx-auto grid max-w-7xl grid-cols-4 gap-10 px-7 py-8 text-sm text-[#667085]">
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">BiletFlow</h3>
          <p>About · Careers · Contact</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">Attendees</h3>
          <p>My tickets · Refund rules · Help</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">Organizers</h3>
          <p>Create event · Pricing · Check-in app</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-[#101828]">Legal</h3>
          <p>Terms · Privacy · Public offer</p>
        </div>
      </div>
    </footer>
  );
};
