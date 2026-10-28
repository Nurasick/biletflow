import { useState, useCallback } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { get, eventDate, type Event } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Details() {
    const { slug } = useLocalSearchParams<{
        slug: string;
    }>();
    const router = useRouter();
    const [event, setEvent] = useState<Event | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => { let active = true; setEvent(null); setError(''); if (!slug) {
        setError('Choose an event from the catalogue.');
        return;
    } get<Event>(`/events/${encodeURIComponent(slug)}`).then(e => { if (active)
        setEvent(e); }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [slug, retry]));
    return <Screen title={event?.title ?? 'Event'}>{error ? <><Label>{error}</Label><Button title="Retry" onPress={() => setRetry(v => v + 1)}/></> : !event ? <Label>Loading event...</Label> : <><Label>{eventDate(event)}</Label><Label>{event.venue_name} ? {event.venue_address}</Label><Label>{event.description ?? 'No description provided.'}</Label><Label>Status: {event.status}</Label><Button title="Choose tickets" disabled={event.status !== 'published'} onPress={() => router.push({ pathname: '/seat-selection', params: { slug: event.slug } })}/></>}</Screen>;
}
