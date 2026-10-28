import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { all, get, decode, money, type Event, type Ticket, type Order } from '@/api/public';
import { useAuth } from '@/hooks/use-auth';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Checkout() {
    const { slug, tickets: ids } = useLocalSearchParams<{
        slug: string;
        tickets: string;
    }>();
    const router = useRouter();
    const { authenticatedFetch } = useAuth();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [order, setOrder] = useState<Order | null>(null);
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => { let active = true; setLoading(true); setError(''); const load = async () => { const selected = [...new Set((ids ?? '').split(',').map(Number))]; if (!slug || !selected.length || selected.some(id => !Number.isSafeInteger(id) || id <= 0))
        throw new Error('Choose tickets before checkout.'); const event = await get<Event>(`/events/${encodeURIComponent(slug)}`); if (event.status !== 'published')
        throw new Error('Event is not available for booking.'); const available = await all<Ticket>(`/events/${event.id}/tickets`); const chosen = available.filter(t => selected.includes(t.id)); if (chosen.length !== selected.length)
        throw new Error('Some tickets are no longer available. Go back and choose again.'); return chosen; }; load().then(data => { if (active)
        setTickets(data); }).catch(e => { if (active) {
        setTickets([]);
        setError(e.message);
    } }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [slug, ids, retry]));
    const reserve = async () => { if (lock.current || order)
        return; lock.current = true; setBusy(true); setError(''); try {
        setOrder(await decode<Order>(await authenticatedFetch('/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_ids: tickets.map(t => t.id) }) })));
    }
    catch (e) {
        setTickets([]);
        setError(`${e instanceof Error ? e.message : 'Reservation failed.'} Review availability before trying again.`);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } };
    return <Screen title={order ? 'Reservation confirmed' : 'Review reservation'}>{order ? <><Label>Order #{order.id} ? {order.status}</Label><Label>Total: {money(order.total_amount)}</Label><Label>{order.expires_at ? `Reserved until ${new Date(order.expires_at).toLocaleString()}` : 'Reservation created.'}</Label><Label>This is a reservation. Payment has not been collected.</Label><Button title="Back to events" onPress={() => router.replace('/')}/></> : <>{loading && <Label>Checking availability...</Label>}{error && <><Label>{error}</Label><Button title="Refresh availability" disabled={busy} onPress={() => setRetry(v => v + 1)}/><Button title="Choose tickets again" disabled={busy} onPress={() => router.replace({ pathname: '/seat-selection', params: { slug } })}/></>}{tickets.map(t => <Label key={t.id}>{t.seat_number ?? `Admission ticket ${t.id}`} ? {money(t.price)}</Label>)}{!!tickets.length && <Label>Total: {money(tickets.reduce((sum, t) => sum + Number(t.price), 0))}</Label>}<Button title={busy ? 'Reserving...' : 'Reserve tickets'} disabled={busy || loading || !tickets.length} onPress={() => void reserve()}/></>}</Screen>;
}
