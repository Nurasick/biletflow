import { API_V1_URL } from '@/constants/api';
export type Event = {
    id: number;
    slug: string;
    title: string;
    description: string | null;
    category: string | null;
    status: string;
    venue_name: string;
    venue_address: string;
    starts_at: string;
    timezone: string;
};
export type TicketType = {
    id: number;
    name: string;
    price_minor: number;
    currency: string;
    available: number;
    max_per_order: number | null;
    sales_start_at: string | null;
    sales_end_at: string | null;
};
export type Order = {
    order_number: string;
    total_minor: number;
    currency: string;
    status: string;
    expires_at: string | null;
};
export const price = (minor: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
export function ticketLimit(type: TicketType) {
    const now = Date.now();
    if ((type.sales_start_at && now < Date.parse(type.sales_start_at)) || (type.sales_end_at && now >= Date.parse(type.sales_end_at)))
        return 0;
    return Math.max(0, Math.min(type.available, type.max_per_order ?? 20, 20));
}
export function checkoutItems(raw: string, types: TicketType[], names: Record<string, string>) {
    const quantities: unknown = JSON.parse(raw);
    if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities))
        throw new Error('Choose tickets first.');
    const items = Object.entries(quantities).map(([key, quantity]) => {
        const type = types.find(t => String(t.id) === key);
        if (!type || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > ticketLimit(type))
            throw new Error('Selection is no longer available. Choose tickets again.');
        const attendees = Array.from({ length: quantity }, (_, index) => {
            const full_name = names[`${key}-${index}`]?.trim() ?? '';
            if (!full_name || full_name.length > 200)
                throw new Error('Enter a name for every attendee (up to 200 characters).');
            return { full_name };
        });
        return { ticket_type_id: type.id, attendees };
    });
    const count = items.reduce((sum, item) => sum + item.attendees.length, 0);
    if (!count || count > 20)
        throw new Error('Choose between 1 and 20 tickets.');
    return items;
}
export async function decode<T>(response: Response): Promise<T> {
    const body = await response.json();
    if (!response.ok) {
        const detail = body?.detail;
        throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((e: {
            msg: string;
        }) => e.msg).join('\n') : 'Request failed. Please try again.');
    }
    return body as T;
}
export async function get<T>(path: string): Promise<T> { return decode<T>(await fetch(`${API_V1_URL}${path}`)); }
export async function all<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0;; offset += 100) {
        const page = await get<T[]>(`${path}?limit=100&offset=${offset}`);
        result.push(...page);
        if (page.length < 100)
            return result;
    }
}
export const money = (value: string | number) => `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KZT`;
export const eventDate = (event: Event) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(event.starts_at));
