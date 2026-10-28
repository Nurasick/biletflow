import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { all, get, money, type Event, type Ticket } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Tickets() {
    const { slug } = useLocalSearchParams<{
        slug: string;
    }>();
    const router = useRouter();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selected, setSelected] = useState<number[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => { let active = true; setLoading(true); setError(''); setSelected([]); const load = async () => { if (!slug)
        throw new Error('Choose an event first.'); const event = await get<Event>(`/events/${encodeURIComponent(slug)}`); if (event.status !== 'published')
        throw new Error('This event is not available for booking.'); return all<Ticket>(`/events/${event.id}/tickets`); }; load().then(data => { if (active)
        setTickets(data); }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [slug, retry]));
    return <Screen title="Choose tickets">{loading ? <Label>Loading availability...</Label> : error ? <><Label>{error}</Label><Button title="Retry" onPress={() => setRetry(v => v + 1)}/></> : <>{!tickets.length && <Label>No tickets currently available.</Label>}{tickets.map(t => <Button key={t.id} title={`${selected.includes(t.id) ? 'Selected: ' : ''}${t.seat_number ?? `Admission ticket ${t.id}`} ? ${money(t.price)}`} onPress={() => setSelected(ids => ids.includes(t.id) ? ids.filter(id => id !== t.id) : [...ids, t.id])}/>)}<Button title={`Continue (${selected.length})`} disabled={!selected.length} onPress={() => router.push({ pathname: '/checkout', params: { slug, tickets: selected.join(',') } })}/></>}</Screen>;
}
