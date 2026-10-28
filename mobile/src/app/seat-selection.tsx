import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { get, price, ticketLimit, type TicketType } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Tickets() {
    const { slug } = useLocalSearchParams<{
        slug: string;
    }>();
    const router = useRouter();
    const [types, setTypes] = useState<TicketType[]>([]);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => {
        let active = true;
        setLoading(true);
        setError('');
        setQuantities({});
        const load = async () => { if (!slug)
            throw new Error('Choose an event first.'); return get<TicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types`); };
        load().then(data => { if (active)
            setTypes(data); }).catch(e => { if (active)
            setError(e.message); }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [slug, retry]));
    const total = Object.values(quantities).reduce((a, b) => a + b, 0);
    return <Screen title="Choose tickets">{loading ? <Label>Loading availability...</Label> : error ? <><Label>{error}</Label><Button title="Retry" onPress={() => setRetry(v => v + 1)}/></> : <>{!types.length && <Label>No ticket types available.</Label>}{types.map(t => <Label key={t.id}>{t.name}: {price(t.price_minor, t.currency)} / {t.available} available</Label>)}{types.map(t => <Button key={t.id} title={`${t.name}: ${quantities[t.id] ?? 0} selected (tap to add or reset at limit)`} disabled={!ticketLimit(t)} onPress={() => setQuantities(q => { const next = { ...q }; const current = q[t.id] ?? 0; if (current >= ticketLimit(t)) {
        delete next[t.id];
    }
    else if (total < 20) {
        next[t.id] = current + 1;
    } return next; })}/>)}<Button title={`Continue (${total})`} disabled={!total} onPress={() => router.push({ pathname: '/checkout', params: { slug, selection: JSON.stringify(quantities) } })}/></>}</Screen>;
}
