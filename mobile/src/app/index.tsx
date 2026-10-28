import { useState } from 'react';
import { TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { all, eventDate, type Event } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
export default function Home() {
    const router = useRouter();
    const [events, setEvents] = useState<Event[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => { let active = true; setLoading(true); setError(''); all<Event>('/events').then(data => { if (active)
        setEvents(data); }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [retry]));
    return <Screen title="Discover events"><TextInput accessibilityLabel="Search events" placeholder="Search events" placeholderTextColor="#98A2B3" className="rounded border border-gray-500 p-3 text-white" value={search} onChangeText={setSearch}/>{loading ? <Label>Loading events...</Label> : error ? <><Label>{error}</Label><Button title="Retry" onPress={() => setRetry(v => v + 1)}/></> : <>{events.filter(e => e.title.toLowerCase().includes(search.toLowerCase())).map(e => <Button key={e.id} title={`${e.title} ? ${eventDate(e)} ? ${e.venue_name}`} onPress={() => router.push({ pathname: '/event-details', params: { slug: e.slug } })}/>)}{!events.length && <Label>No published events available.</Label>}</>}</Screen>;
}
