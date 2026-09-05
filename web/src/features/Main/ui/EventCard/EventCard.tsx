export const formatPrice = (price: number) => {
  return new Intl.NumberFormat("kk-KZ").format(price) + " ₸";
};

export const EventCard = ({
  age,
  price,
  title,
  time,
  venue,
}: {
  age: number;
  price: number;
  title: string;
  time: string;
  venue: string;
}) => {
  return (
    <article>
      <div className="relative aspect-[2/3] rounded-xl border border-[#D0D5DD] bg-[#F5F5F0]">
        <span className="absolute left-3 top-3 rounded bg-[#101828] px-2 py-1 text-[10px] font-semibold text-white">
          {age}+
        </span>

        <span className="absolute bottom-3 left-3 rounded-md bg-white px-2 py-1 text-xs font-semibold shadow">
          from {formatPrice(price)} ₸
        </span>
      </div>

      <h3 className="mt-3 font-semibold">{title}</h3>

      <p className="mt-1 text-sm text-[#667085]">
        {time} · {venue}
      </p>
    </article>
  );
};
