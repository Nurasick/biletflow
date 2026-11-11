import { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ticketLimit } from '@/api/public';
import { ThemedText } from '@/components/themed-text';
import { EVENT, ROWS, SEAT_PRICE, SEATS_PER_ROW, SOLD_SEATS, type SeatType } from '@/constants/seating';
import { eventsApi, formatEventDate, type EventDetail, type PublicTicketType } from '@/shared/api/events';

const PALETTE = {
  dark: {
    background: '#101828', surface: '#182230', raised: '#1D2939', border: '#344054', text: '#F5F5F0', muted: '#98A2B3', accent: '#FF5C35',
    standard: '#FF5C35', premium: '#65C9AE', premiumBg: '#123D3A', vip: '#E7B547', vipBg: '#3A301D', sold: '#475467',
  },
  light: {
    background: '#F5F5F0', surface: '#FFFFFF', raised: '#F9FAF7', border: '#D0D5DD', text: '#101828', muted: '#667085', accent: '#D9431F',
    standard: '#D9431F', premium: '#087E6F', premiumBg: '#E5F5F1', vip: '#9A6700', vipBg: '#FBF1D1', sold: '#98A2B3',
  },
};

type TicketMap = Record<SeatType, PublicTicketType | null>;

function mapTicketTypes(types: PublicTicketType[]): TicketMap {
  const available = types.filter((type) => ticketLimit(type) > 0);
  const sorted = [...available].sort((a, b) => a.price_minor - b.price_minor);
  const forTier = (tier: SeatType, rank: number) => {
    const exactPrice = available.find((type) => type.price_minor === SEAT_PRICE[tier] * 100);
    if (exactPrice) return exactPrice;
    const named = available.find((type) => `${type.name} ${type.description ?? ''}`.toLowerCase().includes(tier));
    return named ?? sorted[Math.min(rank, sorted.length - 1)] ?? null;
  };
  return {
    standard: forTier('standard', 0),
    premium: forTier('premium', Math.floor((sorted.length - 1) / 2)),
    vip: forTier('vip', sorted.length - 1),
  };
}

function seatTier(seatId: string): SeatType {
  const rowName = seatId.split('-')[0];
  return ROWS.find((row) => row.name === rowName)?.type ?? 'standard';
}

export default function SeatSelectionScreen() {
  const router = useRouter();
  const { slug: rawSlug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? PALETTE.dark : PALETTE.light;
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [ticketTypes, setTicketTypes] = useState<PublicTicketType[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<string[]>(slug ? [] : ['3-6', '3-7']);
  const [loading, setLoading] = useState(!!slug);
  const [error, setError] = useState<string | null>(null);
  const previewOnly = !slug;

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      eventsApi.get(slug, controller.signal),
      eventsApi.ticketTypes(slug, controller.signal),
    ]).then(([eventData, types]) => {
      setEvent(eventData);
      setTicketTypes(types);
    }).catch((failure: unknown) => {
      if (failure instanceof Error && failure.name === 'AbortError') return;
      setError(failure instanceof Error ? failure.message : 'Could not load this event.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [slug]);

  const ticketMap = useMemo(() => mapTicketTypes(ticketTypes), [ticketTypes]);
  const seatSize = Math.max(16, Math.min(23, Math.floor((width - 78) / SEATS_PER_ROW) - 3));
  const selectedTotalMinor = selectedSeats.reduce((sum, seatId) => {
    const type = ticketMap[seatTier(seatId)];
    return sum + (type?.price_minor ?? SEAT_PRICE[seatTier(seatId)] * 100);
  }, 0);
  const selectedCounts = selectedSeats.reduce<Record<number, number>>((counts, seatId) => {
    const type = ticketMap[seatTier(seatId)];
    if (type) counts[type.id] = (counts[type.id] ?? 0) + 1;
    return counts;
  }, {});
  const selectedCountByType = (typeId: number) => selectedCounts[typeId] ?? 0;

  const toggleSeat = (seatId: string) => {
    if (SOLD_SEATS.has(seatId)) return;
    if (selectedSeats.includes(seatId)) {
      setSelectedSeats((current) => current.filter((seat) => seat !== seatId));
      return;
    }
    const type = ticketMap[seatTier(seatId)];
    if (previewOnly) {
      setSelectedSeats((current) => [...current, seatId]);
      return;
    }
    if (selectedSeats.length >= 20 || !type || selectedCountByType(type.id) >= ticketLimit(type)) return;
    setSelectedSeats((current) => [...current, seatId]);
  };

  const continueToCheckout = () => {
    if (!slug || !selectedSeats.length) return;
    const items = Object.fromEntries(Object.entries(selectedCounts).map(([id, quantity]) => [id, quantity]));
    router.push({
      pathname: '/checkout',
      params: { slug, selection: JSON.stringify(items), seats: selectedSeats.join(',') },
    });
  };

  const title = event?.title ?? EVENT.title;
  const eventWhen = event ? `${formatEventDate(event.starts_at)} · ${event.venue_name}` : `${EVENT.date} · ${EVENT.time} · ${EVENT.hall}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable accessibilityLabel="Go back to event details" onPress={() => router.back()} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
          <ThemedText style={{ color: colors.text, fontSize: 19 }}>‹</ThemedText>
        </Pressable>
        <ThemedText style={{ flex: 1, color: colors.text, textAlign: 'center', fontSize: 15, fontWeight: '800' }}>Select seats</ThemedText>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 22 }}>
        <ThemedText style={{ color: colors.text, fontSize: 17, fontWeight: '900' }}>{title}</ThemedText>
        <ThemedText style={{ marginTop: 4, color: colors.muted, fontSize: 11 }}>{eventWhen}</ThemedText>

        <View style={{ marginTop: 14, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
          <ThemedText style={{ color: colors.muted, fontSize: 11, lineHeight: 16 }}>
            Seat map preview. This backend currently reserves ticket quantities only; selected seat numbers are not held or saved on the ticket.
          </ThemedText>
        </View>

        {loading ? <View style={{ alignItems: 'center', paddingVertical: 36 }}><ActivityIndicator color={colors.accent} /><ThemedText style={{ marginTop: 10, color: colors.muted }}>Loading event and ticket types…</ThemedText></View> : error ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}><ThemedText style={{ color: colors.text, textAlign: 'center' }}>{error}</ThemedText></View>
        ) : <>
          <View style={{ height: 36, marginTop: 23, alignItems: 'center', justifyContent: 'center', borderBottomLeftRadius: 28, borderBottomRightRadius: 28, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }}>
            <ThemedText style={{ color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 2 }}>STAGE</ThemedText>
          </View>

          <View style={{ marginTop: 17, gap: 5 }}>
            {ROWS.map((row) => <View key={row.name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <ThemedText style={{ width: 14, color: colors.muted, fontSize: 9, textAlign: 'center' }}>{row.name}</ThemedText>
              {Array.from({ length: SEATS_PER_ROW }, (_, index) => {
                const seatId = `${row.name}-${index + 1}`;
                const sold = SOLD_SEATS.has(seatId);
                const selected = selectedSeats.includes(seatId);
                const mappedType = ticketMap[row.type];
                const atLimit = !!mappedType && selectedCountByType(mappedType.id) >= ticketLimit(mappedType);
                const unavailable = !previewOnly && (!mappedType || atLimit || selectedSeats.length >= 20) && !selected;
                const tierColor = row.type === 'standard' ? colors.standard : row.type === 'premium' ? colors.premium : colors.vip;
                return <Pressable
                  key={seatId}
                  accessibilityRole="button"
                  accessibilityLabel={`Row ${row.name}, seat ${index + 1}, ${sold ? 'sold' : selected ? 'selected' : unavailable ? 'unavailable' : row.type}`}
                  accessibilityState={{ disabled: sold || unavailable, selected }}
                  disabled={sold || unavailable}
                  onPress={() => toggleSeat(seatId)}
                  style={{ width: seatSize, height: seatSize, marginHorizontal: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: sold || selected ? 0 : 1, borderColor: tierColor, backgroundColor: sold ? colors.sold : selected ? colors.accent : row.type === 'standard' ? colors.surface : row.type === 'premium' ? colors.premiumBg : colors.vipBg, opacity: unavailable ? 0.4 : 1 }}>
                  <ThemedText style={{ color: sold ? '#FFFFFF' : selected ? '#FFFFFF' : tierColor, fontSize: 9, fontWeight: '800' }}>{sold ? '×' : selected ? '✓' : ''}</ThemedText>
                </Pressable>;
              })}
              <ThemedText style={{ width: 14, color: colors.muted, fontSize: 9, textAlign: 'center' }}>{row.name}</ThemedText>
            </View>)}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 11, marginTop: 17 }}>
            <Legend color={colors.accent} label="Selected" colors={colors} filled />
            <Legend color={colors.standard} label="Standard" colors={colors} />
            <Legend color={colors.premium} label="Premium" colors={colors} filled />
            <Legend color={colors.vip} label="VIP" colors={colors} filled />
            <Legend color={colors.sold} label="Sold" colors={colors} filled />
          </View>

          <View style={{ marginTop: 16, overflow: 'hidden', borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 13, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <ThemedText style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>Selected seats ({selectedSeats.length})</ThemedText>
              <Pressable accessibilityRole="button" disabled={!selectedSeats.length} onPress={() => setSelectedSeats([])}><ThemedText style={{ color: colors.accent, fontSize: 10, fontWeight: '800' }}>Clear all</ThemedText></Pressable>
            </View>
            {!selectedSeats.length ? <ThemedText style={{ padding: 13, color: colors.muted, fontSize: 11 }}>Choose available seats from the map above.</ThemedText> : selectedSeats.map((seatId) => {
              const tier = seatTier(seatId);
              const type = ticketMap[tier];
              const amount = previewOnly ? SEAT_PRICE[tier] * 100 : (type?.price_minor ?? 0);
              return <View key={seatId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View>
                  <ThemedText style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>Row {seatId.split('-')[0]} · Seat {seatId.split('-')[1]}</ThemedText>
                  <ThemedText style={{ marginTop: 2, color: colors.muted, fontSize: 10, textTransform: 'capitalize' }}>{type?.name ?? tier}</ThemedText>
                </View>
                <ThemedText style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: type?.currency ?? 'KZT', maximumFractionDigits: 0 }).format(amount / 100)}</ThemedText>
              </View>;
            })}
          </View>
        </>}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 15, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
        <View>
          <ThemedText style={{ color: colors.muted, fontSize: 10 }}>Total</ThemedText>
          <ThemedText style={{ marginTop: 2, color: colors.text, fontSize: 14, fontWeight: '900' }}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: ticketTypes[0]?.currency ?? 'KZT', maximumFractionDigits: 0 }).format(selectedTotalMinor / 100)}</ThemedText>
        </View>
        <Pressable accessibilityRole="button" disabled={!slug || !selectedSeats.length || loading || !!error} onPress={continueToCheckout} style={{ minWidth: 154, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, height: 46, borderRadius: 12, backgroundColor: slug && selectedSeats.length ? colors.accent : colors.sold, opacity: loading || error ? 0.5 : 1 }}>
          <ThemedText style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>{previewOnly ? 'Preview only' : 'Continue'}</ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Legend({ color, label, colors, filled = false }: { color: string; label: string; colors: typeof PALETTE.dark; filled?: boolean }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
    <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: filled ? color : 'transparent', borderWidth: filled ? 0 : 1, borderColor: color }} />
    <ThemedText style={{ color: colors.muted, fontSize: 9 }}>{label}</ThemedText>
  </View>;
}
