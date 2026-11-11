import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { get, price, ticketLimit, type TicketType } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';

export default function TicketSelectionScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
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
    const load = async () => {
      if (!slug) throw new Error('Choose an event first.');
      return get<TicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types`);
    };
    load()
      .then((data) => { if (active) setTypes(data); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Could not load ticket types.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, retry]));

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);

  return (
    <Screen title="Choose tickets">
      {loading ? <Label>Loading availability...</Label> : error ? <>
        <Label>{error}</Label>
        <Button title="Retry" onPress={() => setRetry((value) => value + 1)} />
      </> : <>
        {!types.length && <Label>No ticket types available.</Label>}
        {types.map((type) => <Label key={type.id}>{type.name}: {price(type.price_minor, type.currency)} / {type.available} available</Label>)}
        {types.map((type) => <Button
          key={type.id}
          title={`${type.name}: ${quantities[type.id] ?? 0} selected (tap to add or reset at limit)`}
          disabled={!ticketLimit(type)}
          onPress={() => setQuantities((current) => {
            const next = { ...current };
            const selected = current[type.id] ?? 0;
            if (selected >= ticketLimit(type)) delete next[type.id];
            else if (total < 20) next[type.id] = selected + 1;
            return next;
          })}
        />)}
        <Button
          title={`Continue (${total})`}
          disabled={!total}
          onPress={() => router.push({ pathname: '/checkout', params: { slug, selection: JSON.stringify(quantities) } })}
        />
      </>}
    </Screen>
  );
}
