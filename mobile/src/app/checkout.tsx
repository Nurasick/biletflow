import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { checkoutItems, decode, get, type Order, type TicketType } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
import { Action, FormField, Panel } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { promotionsApi, type PromoQuote } from '@/shared/api/events';
import { accountApi } from '@/shared/api/account';

export default function Checkout() {
  const { slug, selection, seats, campaignToken: rawCampaignToken } = useLocalSearchParams<{ slug: string; selection: string; seats?: string; campaignToken?: string|string[] }>();
  const campaignToken = Array.isArray(rawCampaignToken) ? rawCampaignToken[0] : rawCampaignToken;
  const router = useRouter();
  const { t, locale, formatDate, formatNumber } = useI18n();
  const price = (minor: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
  const { authenticatedFetch, user } = useAuth();
  const [types, setTypes] = useState<TicketType[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoQuote, setPromoQuote] = useState<PromoQuote | null>(null);
  const [activeCampaignToken, setActiveCampaignToken] = useState(campaignToken ?? '');
  const [promoError, setPromoError] = useState('');
  const lock = useRef(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [names, setNames] = useState<Record<string, string>>({});

  // Prefill the contact with the signed-in account; the attendee can still change it.
  useEffect(() => {
    const controller = new AbortController();
    void accountApi.get(authenticatedFetch, controller.signal).then((account) => {
      if (controller.signal.aborted) return;
      setName((current) => current || `${account.first_name} ${account.last_name}`.trim());
      setEmail((current) => current || account.email);
    }).catch(() => { /* Prefill is a convenience; the fields stay editable. */ });
    return () => controller.abort();
  }, [authenticatedFetch]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    get<TicketType[]>(`/events/${encodeURIComponent(slug ?? '')}/ticket-types`)
      .then((data) => { if (active) setTypes(data); })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load ticket availability.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]));

  useEffect(() => {
    if (!campaignToken || loading || !types.length || !slug) return;
    let active = true;
    setPromoBusy(true);
    setPromoError('');
    let items: { ticket_type_id: number; quantity: number }[] = [];
    try {
      const values = JSON.parse(selection ?? '{}') as Record<string, number>;
      items = Object.entries(values).map(([id, quantity]) => ({ ticket_type_id: Number(id), quantity }));
    } catch { /* The normal selection validation below will show the error. */ }
    void promotionsApi.quote(slug, { token: campaignToken }, items).then(quote => {
      if (active) { setPromoQuote(quote); setPromoCode(quote.code); setActiveCampaignToken(campaignToken); }
    }).catch(failure => {
      if (active) setPromoError(failure instanceof Error ? failure.message : 'Could not apply this campaign.');
    }).finally(() => { if (active) setPromoBusy(false); });
    return () => { active = false; };
  }, [campaignToken, loading, types.length, slug, selection]);

  let attendees: { key: string; label: string }[] = [];
  let estimated = 0;
  let selectionError = '';
  try {
    const values: unknown = JSON.parse(selection ?? '{}');
    const placeholders: Record<string, string> = {};
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Choose tickets first.');
    for (const [id, quantity] of Object.entries(values)) {
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('Invalid ticket quantity.');
      const type = types.find((ticket) => String(ticket.id) === id);
      for (let index = 0; index < quantity; index += 1) {
        const key = `${id}-${index}`;
        placeholders[key] = 'Attendee';
        attendees.push({ key, label: t('{ticket} attendee {number}', { ticket: type?.name ?? t('Ticket'), number: formatNumber(index + 1) }) });
      }
    }
    if (!loading) {
      const items = checkoutItems(selection ?? '{}', types, placeholders);
      estimated = items.reduce((sum, item) => sum + (types.find((ticket) => ticket.id === item.ticket_type_id)?.price_minor ?? 0) * item.attendees.length, 0);
    }
  } catch (selectionFailure) {
    selectionError = selectionFailure instanceof Error ? selectionFailure.message : 'Invalid ticket selection.';
    attendees = [];
  }

  const applyPromo = async () => {
    if (!slug || promoBusy) return;
    setPromoBusy(true);
    setPromoError('');
    setPromoQuote(null);
    try {
      const values = JSON.parse(selection ?? '{}') as Record<string, number>;
      const items = Object.entries(values).map(([id, quantity]) => ({ ticket_type_id: Number(id), quantity }));
      const quote = await promotionsApi.quote(slug, promoCode.trim() ? { code: promoCode.trim() } : { token: campaignToken ?? '' }, items);
      setPromoQuote(quote);
      setPromoCode(quote.code);
      setActiveCampaignToken(promoCode.trim() ? '' : campaignToken ?? '');
    } catch (promoFailure) {
      setPromoError(promoFailure instanceof Error ? promoFailure.message : 'Could not apply this promo code.');
    } finally {
      setPromoBusy(false);
    }
  };

  const reserve = async () => {
    if (lock.current || order) return;
    setError('');
    try {
      if (!name.trim() || !email.trim()) throw new Error('Enter your contact name and email.');
      const items = checkoutItems(selection ?? '{}', types, names);
      lock.current = true;
      setBusy(true);
      setOrder(await decode<Order>(await authenticatedFetch(`/events/${encodeURIComponent(slug ?? '')}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_name: name.trim(), contact_email: email.trim(), items, ...(promoQuote ? (activeCampaignToken ? { campaign_token: activeCampaignToken } : { promo_code: promoQuote.code }) : {}) }),
      })));
    } catch (reserveFailure) {
      setError(reserveFailure instanceof Error ? reserveFailure.message : 'Reservation failed.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const field = (label: string, value: string, change: (next: string) => void, isEmail = false) => (
    <FormField
      label={label}
      value={value}
      onChangeText={change}
      editable={!busy}
      maxLength={isEmail ? 254 : 200}
      keyboardType={isEmail ? 'email-address' : 'default'}
      autoCapitalize={isEmail ? 'none' : 'words'}
    />
  );
  const seatPreview = seats?.split(',').filter(Boolean) ?? [];

  if (order) {
    return (
      <Screen title={t('Order created')}>
        <Panel>
          <Label>{t('Order {number}: {status}', { number: order.order_number, status: t(order.status) })}</Label>
          <Label>{t('Total: {amount}', { amount: price(order.total_minor, order.currency) })}</Label>
          <Label tone={order.expires_at ? 'muted' : 'success'}>{order.expires_at ? t('Reserved until {date}', { date: formatDate(order.expires_at) }) : t('Order confirmed.')}</Label>
          <Label tone="muted">{t(order.status === 'pending' ? 'Payment is still required. Open My tickets to complete the demo payment.' : 'Your free order is confirmed.')}</Label>
        </Panel>
        <Button title={t('Open my tickets')} onPress={() => router.dismissTo('/tickets')} />
        <Button secondary title={t('Back to events')} onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('Review reservation')}>
      {loading && <Label>{t('Checking availability...')}</Label>}
      {(error || selectionError) && <Label tone="error">{t(error || selectionError)}</Label>}
      {!loading && !selectionError && <>
        <Panel>
          <Label>{t('Ticket subtotal: {amount}', { amount: price(estimated, types[0]?.currency ?? 'KZT') })}</Label>
          {promoQuote && <Label tone="success">{t('Promo {code} applied: -{discount}. Total {total}.', { code: promoQuote.code, discount: price(promoQuote.discount_minor, types[0]?.currency ?? 'KZT'), total: price(promoQuote.total_minor, types[0]?.currency ?? 'KZT') })}</Label>}
          {seatPreview.length > 0 && <Label tone="muted">{t('Seat preview: {seats}. The backend will reserve the ticket types, but does not hold or save seat numbers yet.', { seats: seatPreview.map((seat) => t('Row {row}, seat {seat}', { row: seat.split('-')[0], seat: seat.split('-')[1] })).join(' / ') })}</Label>}
          <FormField
            label={t('Promo code')}
            value={promoCode}
            onChangeText={(value) => { setPromoCode(value); setPromoQuote(null); setActiveCampaignToken(''); setPromoError(''); }}
            autoCapitalize="characters"
            editable={!busy && !promoBusy}
            maxLength={64}
          />
          <Action secondary disabled={!promoCode.trim() || promoBusy || busy} onPress={() => void applyPromo()} label={t(promoBusy ? 'Checking...' : promoQuote ? 'Applied' : 'Apply')} />
          {!!promoError && <Label tone="error">{t(promoError)}</Label>}
        </Panel>
        <Panel>
          {field(t('Contact name'), name, setName)}
          {field(t('Contact email'), email, setEmail, true)}
          {attendees.map((attendee) => (
            <View key={attendee.key}>{field(attendee.label, names[attendee.key] ?? '', (value) => setNames((current) => ({ ...current, [attendee.key]: value })))}</View>
          ))}
        </Panel>
      </>}
      <Button title={t(busy ? 'Reserving...' : 'Reserve tickets')} disabled={busy || loading || !!selectionError || !types.length} onPress={() => void reserve()} />
      <Button secondary title={t(seatPreview.length ? 'Choose seats again' : 'Choose tickets again')} disabled={busy}
        onPress={() => router.replace({ pathname: seatPreview.length ? '/seat-selection' : '/ticket-selection', params: { slug, ...(campaignToken ? { campaignToken } : {}) } })} />
    </Screen>
  );
}
