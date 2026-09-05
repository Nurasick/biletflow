import { formatPrice } from "../../../Main/ui/EventCard/EventCard";

const ticketTypes = [
  { name: "Standard", note: "Main hall", price: 8500 },
  { name: "Student", note: "Student ID required", price: 6000 },
  { name: "VIP", note: "Best view", price: 12000 },
];

export const PurchasePanel = () => {
  return (
    <aside className="w-[300px] shrink-0">
      <div className="sticky top-5 overflow-hidden rounded-xl border border-[#D0D5DD] shadow-sm">
        <div className="border-b border-[#D0D5DD] p-4">
          <h2 className="text-[15px] font-semibold">Sat 18 Apr · 19:00</h2>
          <p className="mt-1 text-[11px] text-[#667085]">
            Main hall · sales close 18:00
          </p>
        </div>

        {ticketTypes.map((ticket) => (
          <div
            key={ticket.name}
            className="flex items-center justify-between gap-3 border-b border-[#D0D5DD] p-4"
          >
            <div>
              <h3 className="text-sm font-semibold">{ticket.name}</h3>
              <p className="mt-1 text-xs text-[#667085]">{ticket.note}</p>
              <p className="mt-1.5 text-sm font-semibold">
                {formatPrice(ticket.price)}
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 text-sm font-semibold">
              <button className="text-[#667085]">−</button>
              <span>0</span>
              <button className="text-[#FF5C35]">+</button>
            </div>
          </div>
        ))}

        <div className="p-4">
          <div className="flex justify-between text-sm text-[#667085]">
            <span>Subtotal</span>
            <span>0 ₸</span>
          </div>
          <button className="mt-3 w-full rounded-lg bg-[#FF5C35] px-4 py-3 text-sm font-semibold text-[#101828]">
            Choose seats
          </button>
          <p className="mt-2 text-center text-[11px] leading-5 text-[#667085]">
            Max 6 per order · seats held 15 min
          </p>
        </div>
      </div>

      <div className="mt-3.5 rounded-xl border border-[#D0D5DD] bg-[#F5F5F0] p-3.5 text-xs leading-6 text-[#344054]">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
          Buying safely
        </h3>
        <p>Organizer identity and payout verified</p>
        <p>Full refund until 11 Apr</p>
        <p>Support case from any order</p>
      </div>
    </aside>
  );
};
