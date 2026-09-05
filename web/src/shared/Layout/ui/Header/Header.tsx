export const Header = () => {
  return (
    <header className="border-b border-[#D0D5DD]">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-7 py-4">
        <div className="shrink-0 text-2xl font-bold tracking-tight">
          Bilet<span className="text-[#FF5C35]">Flow</span>
        </div>

        <div className="flex h-12 flex-1 overflow-hidden rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]">
          <input
            type="text"
            placeholder="Search events, venues, organizers"
            className="min-w-0 flex-1 bg-transparent px-4 text-sm outline-none placeholder:text-[#667085]"
          />
          <button className="border-l border-[#D0D5DD] px-4 text-sm text-[#667085]">
            Any date ▾
          </button>
          <button className="bg-[#FF5C35] px-6 text-sm font-semibold text-[#101828]">
            Search
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#D0D5DD] text-[#667085]">
            ☰
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#FF5C35] px-1 text-[10px] font-semibold text-[#101828]">
              2
            </span>
          </button>

          <button className="flex items-center gap-3 rounded-full border border-[#D0D5DD] py-1.5 pl-1.5 pr-4">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-orange-50 text-xs font-semibold text-[#FF5C35]">
              AN
            </div>
            <div className="text-left text-xs">
              <div className="font-semibold">Shamil O'Nil</div>
              <div className="text-[#667085]">3 tickets</div>
            </div>
            <span className="text-xs text-[#667085]">▾</span>
          </button>

          <button className="rounded-xl bg-[#FF5C35] px-5 py-3 text-sm font-semibold text-[#101828]">
            Create event
          </button>
        </div>
      </div>

      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-7 py-3 text-sm">
        <a className="font-semibold" href="#">
          Afisha
        </a>
        <a className="text-[#667085]" href="#">
          Concerts
        </a>
        <a className="text-[#667085]" href="#">
          Theatre
        </a>
        <a className="text-[#667085]" href="#">
          Cinema
        </a>
        <a className="text-[#667085]" href="#">
          Sport
        </a>
        <a className="text-[#667085]" href="#">
          Student
        </a>
        <a className="text-[#667085]" href="#">
          Free events
        </a>
        <a className="ml-auto font-semibold text-[#FF5C35]" href="#">
          My tickets
        </a>
      </nav>
    </header>
  );
};
