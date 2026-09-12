export const EventInfo = () => {
  return (
    <section className="flex gap-6">
      <div className="aspect-[2/3] w-[150px] shrink-0 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]" />

      <div className="flex-1">
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-md bg-[#F5F5F0] px-2 py-1 text-[#667085]">
            CONCERT
          </span>
          <span className="rounded-md bg-[#101828] px-2 py-1 text-white">
            16+
          </span>
          <span className="rounded-md bg-orange-50 px-2 py-1 text-[#FF5C35]">
            ASSIGNED SEATING
          </span>
        </div>

        <h1 className="mt-3 text-[27px] font-bold leading-tight tracking-tight">
          Almaty Indie Night — Spring Edition
        </h1>

        <div className="mt-3 text-[13px] leading-6 text-[#667085]">
          <p>
            120 min · KBTU Music Club{" "}
            <span className="font-bold text-[#FF5C35]">✓</span> · 14 events
          </p>
          <p>Palace of Republic · Dostyk Ave 56, Almaty</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2">
            Add to calendar
          </button>
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2">
            Share
          </button>
          <button className="rounded-lg border border-[#D0D5DD] px-3.5 py-2 text-[#667085]">
            Refund rules
          </button>
        </div>
      </div>
    </section>
  );
};
