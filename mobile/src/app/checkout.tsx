import { useCallback, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { get, decode, price, checkoutItems, type TicketType, type Order } from '@/api/public';
import { useAuth } from '@/hooks/use-auth';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Checkout() {
    const { slug, selection } = useLocalSearchParams<{
        slug: string;
        selection: string;
    }>();
    const router = useRouter();
    const { authenticatedFetch, user } = useAuth();
    const [types, setTypes] = useState<TicketType[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [order, setOrder] = useState<Order | null>(null);
    const [name, setName] = useState('');
    const [email, setEmail] = useState(user?.email ?? '');
    const [names, setNames] = useState<Record<string, string>>({});
    useFocusEffect(useCallback(() => { let active = true; setLoading(true); setError(''); get<TicketType[]>(`/events/${encodeURIComponent(slug ?? '')}/ticket-types`).then(data => { if (active)
        setTypes(data); }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [slug]));
    let attendees: {
        key: string;
        label: string;
    }[] = [];
    let estimated = 0;
    let selectionError = '';
    try {
        const values = JSON.parse(selection ?? '{}');
        const placeholder: Record<string, string> = {};
        for (const [id, q] of Object.entries(values)) {
            if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 20)
                throw new Error('Invalid quantity.');
            for (let i = 0; i < q; i++) {
                placeholder[`${id}-${i}`] = 'Attendee';
                attendees.push({ key: `${id}-${i}`, label: `${types.find(t => String(t.id) === id)?.name ?? 'Ticket'} attendee ${i + 1}` });
            }
        }
        if (!loading) {
            const items = checkoutItems(selection ?? '{}', types, placeholder);
            estimated = items.reduce((sum, item) => sum + (types.find(t => t.id === item.ticket_type_id)?.price_minor ?? 0) * item.attendees.length, 0);
        }
    }
    catch (e) {
        selectionError = e instanceof Error ? e.message : 'Invalid selection.';
        attendees = [];
    }
    const reserve = async () => { if (lock.current || order)
        return; setError(''); try {
        if (!name.trim() || !email.trim())
            throw new Error('Enter your contact name and email.');
        const items = checkoutItems(selection ?? '{}', types, names);
        lock.current = true;
        setBusy(true);
        setOrder(await decode<Order>(await authenticatedFetch(`/events/${encodeURIComponent(slug)}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_name: name.trim(), contact_email: email.trim(), items }) })));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Reservation failed.');
    }
    finally {
        lock.current = false;
        setBusy(false);
    } };
    const field = (label: string, value: string, change: (s: string) => void) => <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor="#98A2B3" value={value} onChangeText={change} editable={!busy} maxLength={label === 'Contact email' ? 254 : 200} keyboardType={label === 'Contact email' ? 'email-address' : 'default'} className="rounded border border-gray-500 p-3 text-white"/>;
    return <Screen title={order ? 'Order created' : 'Review reservation'}>{order ? <><Label>Order {order.order_number}: {order.status}</Label><Label>Total: {price(order.total_minor, order.currency)}</Label><Label>{order.expires_at ? `Reserved until ${new Date(order.expires_at).toLocaleString()}` : 'Order confirmed.'}</Label><Label>{order.status === 'pending' ? 'Payment is still required. No payment was collected by this screen.' : 'Your free order is confirmed.'}</Label><Button title="Back to events" onPress={() => router.replace('/')}/></> : <>{loading && <Label>Checking availability...</Label>}{(error || selectionError) && <Label>{error || selectionError}</Label>}{!loading && !selectionError && <><Label>Ticket subtotal: {price(estimated, types[0]?.currency ?? 'KZT')}</Label>{field('Contact name', name, setName)}{field('Contact email', email, setEmail)}{attendees.map(a => <View key={a.key}>{field(a.label, names[a.key] ?? '', value => setNames(n => ({ ...n, [a.key]: value })))}</View>)}</>}<Button title={busy ? 'Reserving...' : 'Reserve tickets'} disabled={busy || loading || !!selectionError || !types.length} onPress={() => void reserve()}/><Button title="Choose tickets again" disabled={busy} onPress={() => router.replace({ pathname: '/seat-selection', params: { slug } })}/></>}</Screen>;
}
