import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { get, ticketLimit, type TicketType } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
import { useI18n } from '@/i18n';

export default function TicketSelectionScreen() {
  const { slug, campaignToken } = useLocalSearchParams<{ slug?: string; campaignToken?: string|string[] }>();
  const token = Array.isArray(campaignToken) ? campaignToken[0] : campaignToken;
  const router = useRouter();
  const { t, locale, formatNumber } = useI18n();
  const price = (minor: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
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
    <Screen title={t('Choose tickets')}>
      {loading ? <Label>{t('Loading availability...')}</Label> : error ? <>
        <Label>{t(error)}</Label>
        <Button title={t('Retry')} onPress={() => setRetry((value) => value + 1)} />
      </> : <>
        {!types.length && <Label>{t('No ticket types available.')}</Label>}
        {types.map((type) => <Label key={type.id}>{t('{ticket}: {price} / {count} available', { ticket: type.name, price: price(type.price_minor, type.currency), count: formatNumber(type.available) })}</Label>)}
        {types.map((type) => <Button
          key={type.id}
          title={t('{ticket}: {count} selected (tap to add or reset at limit)', { ticket: type.name, count: formatNumber(quantities[type.id] ?? 0) })}
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
          title={t('Continue ({count})', { count: formatNumber(total) })}
          disabled={!total}
          onPress={() => router.push({ pathname: '/checkout', params: { slug, selection: JSON.stringify(quantities), ...(token ? { campaignToken: token } : {}) } })}
        />
      </>}
    </Screen>
  );
}
