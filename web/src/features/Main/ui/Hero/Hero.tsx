export const Hero = () => {
  return (
    <section className="grid grid-cols-3 gap-5">
      {/* Featured event */}
      <div className="col-span-2 flex min-h-[280px] items-end rounded-2xl border border-[#D0D5DD] bg-[#F5F5F0] p-6">
        <div className="max-w-sm rounded-xl bg-white p-5 shadow-lg">
          <div className="text-xs font-semibold tracking-wider text-[#FF5C35]">
            FEATURED · THIS WEEKEND
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Almaty Indie Night — Spring Edition
          </h1>

          <p className="mt-2 text-sm text-[#667085]">
            Sat 18 Apr · 19:00 · Palace of Republic
          </p>

          <div className="mt-5 flex items-center gap-4">
            <button className="rounded-lg bg-[#FF5C35] px-5 py-2.5 text-sm font-semibold">
              Buy tickets
            </button>

            <span className="text-sm font-semibold">from 8 500 ₸</span>
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex flex-col gap-4">
        <div className="flex-1 rounded-xl border border-[#D0D5DD] p-5">
          <h2 className="font-semibold">Your next event</h2>

          <p className="mt-2 text-sm leading-6 text-[#667085]">
            Almaty Indie Night
            <br />
            Sat 18 Apr · Row 3, seat 12
          </p>

          <div className="mt-4 flex gap-2">
            <button className="rounded-lg border border-[#D0D5DD] px-4 py-2 text-xs font-semibold">
              Show QR
            </button>

            <button className="rounded-lg border border-[#D0D5DD] px-4 py-2 text-xs font-semibold text-[#667085]">
              Calendar
            </button>
          </div>
        </div>

        <div className="flex-1 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] p-5">
          <h2 className="font-semibold">Organizing something?</h2>

          <p className="mt-2 text-sm leading-6 text-[#667085]">
            Free events and QR check-in cost nothing. Pay only to sell tickets.
          </p>

          <button className="mt-4 text-sm font-semibold text-[#FF5C35]">
            Start an event →
          </button>
        </div>
      </div>
    </section>
  );
};
