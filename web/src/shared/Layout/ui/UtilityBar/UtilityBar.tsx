export const UtilityBar = () => {
  return (
    <div className="bg-[#101828] px-7 py-2.5 text-xs text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-5">
          <span className="font-semibold">Almaty ▾</span>
          <span className="text-[#98A2B3]">Help centre</span>
          <span className="text-[#98A2B3]">For organizers</span>
        </div>
        <div className="flex items-center gap-5 text-[#98A2B3]">
          <span>EN · RU · KZ</span>
          <span>+7 727 000 00 00</span>
        </div>
      </div>
    </div>
  );
};
