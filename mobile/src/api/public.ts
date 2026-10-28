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
export type Ticket = {
    id: number;
    event_id: number;
    seat_number: string | null;
    price: string;
    status: string;
};
export type Order = {
    id: number;
    total_amount: string;
    status: string;
    expires_at: string | null;
    tickets: Ticket[];
};
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
