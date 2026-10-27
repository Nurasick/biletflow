// Mock event and seat map shared by the seat selection and checkout screens until they load from the API.

export type SeatType = 'standard' | 'premium' | 'vip';

export const EVENT = {
  title: 'Almaty Indie Night',
  date: 'Sat 18 Apr',
  time: '19:00',
  venue: 'Palace of Republic',
  hall: 'Main hall',
};

export const ROWS: { name: string; type: SeatType }[] = [
  { name: '1', type: 'standard' },
  { name: '2', type: 'standard' },
  { name: '3', type: 'standard' },
  { name: '4', type: 'premium' },
  { name: '5', type: 'premium' },
  { name: '6', type: 'vip' },
  { name: '7', type: 'vip' },
];
export const SEATS_PER_ROW = 12;
export const SOLD_SEATS = new Set(['2-5', '2-6', '5-7', '5-8', '7-4', '7-5', '7-6', '7-7', '7-8', '7-9']);
export const SEAT_PRICE: Record<SeatType, number> = { standard: 8500, premium: 12000, vip: 15000 };
export const PROCESSING_FEE = 410;

export type Seat = { id: string; row: string; number: string; type: SeatType; price: number };

/** Resolves a seat ID like "3-6" to its row, number, tier and price. Returns null for unknown or sold seats. */
export function getSeat(id: string): Seat | null {
  const [rowName, number] = id.split('-');
  const row = ROWS.find((item) => item.name === rowName);
  const seatNumber = Number(number);
  if (!row || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > SEATS_PER_ROW || SOLD_SEATS.has(id)) {
    return null;
  }

  return { id, row: row.name, number, type: row.type, price: SEAT_PRICE[row.type] };
}

/** Formats an amount as "17 410 ₸". */
export function formatTenge(amount: number) {
  return `${amount.toLocaleString('en-US').replaceAll(',', ' ')} ₸`;
}
