import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { eventsApi, formatEventDate, formatEventPrice, resolveEventImage, type EventDetail, type PublicTicketType } from '@/shared/api/events';

const palette = {
  dark: { background: '#101828', surface: '#182230', raised: '#1D2939', border: '#344054', text: '#F5F5F0', muted: '#98A2B3', accent: '#FF5C35', paleAccent: '#FFA38B' },
  light: { background: '#F5F5F0', surface: '#FFFFFF', raised: '#F9FAF7', border: '#D0D5DD', text: '#101828', muted: '#667085', accent: '#D9431F', paleAccent: '#A93216' },
};

export default function EventDetailsScreen() {
  const router = useRouter();
  const { slug: rawSlug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? palette.dark : palette.light;
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [ticketTypes, setTicketTypes] = useState<PublicTicketType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setError('This event link is missing its event identifier.');
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void Promise.all([
      eventsApi.get(slug, controller.signal),
      eventsApi.ticketTypes(slug, controller.signal),
    ]).then(([eventInfo, types]) => {
      setEvent(eventInfo);
      setTicketTypes(types);
    }).catch((requestError: unknown) => {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(requestError instanceof Error ? requestError.message : 'Could not load this event.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [slug]);

  const imageUrl = useMemo(() => resolveEventImage(event?.cover_image_url), [event?.cover_image_url]);
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/');
  const category = event?.category ? event.category.replace('_', ' ').toUpperCase() : 'EVENT';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable accessibilityLabel="Go back" onPress={goBack} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
          <ThemedText style={{ color: colors.text, fontSize: 19 }}>‹</ThemedText>
        </Pressable>
        <ThemedText style={{ flex: 1, color: colors.text, textAlign: 'center', fontSize: 15, fontWeight: '700' }}>Event details</ThemedText>
        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /><ThemedText style={{ marginTop: 12, color: colors.muted }}>Loading event…</ThemedText></View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <ThemedText style={{ color: colors.text, textAlign: 'center', fontSize: 15, fontWeight: '700' }}>Event unavailable</ThemedText>
          <ThemedText style={{ marginTop: 8, color: colors.muted, textAlign: 'center', fontSize: 13 }}>{error}</ThemedText>
          <Pressable onPress={goBack} style={{ marginTop: 18, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: colors.accent }}><ThemedText style={{ color: '#FFFFFF', fontWeight: '700' }}>Back to events</ThemedText></Pressable>
        </View>
      ) : event ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={{ height: 230, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: '#3A2731', padding: 18 }}>
              {imageUrl && <Image source={{ uri: imageUrl }} contentFit="cover" transition={180} style={{ position: 'absolute', width: '100%', height: '100%' }} />}
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#101828', opacity: imageUrl ? 0.48 : 1 }} />
              {!imageUrl && <View style={{ position: 'absolute', right: -10, top: 6, width: 180, height: 180, borderRadius: 90, borderWidth: 25, borderColor: colors.accent, opacity: 0.22 }} />}
              <ThemedText style={{ marginBottom: 5, color: colors.paleAccent, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{category}{event.phase === 'completed' ? ' · COMPLETED' : ''}</ThemedText>
              <ThemedText style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '900', lineHeight: 30 }}>{event.title}</ThemedText>
              <ThemedText numberOfLines={1} style={{ marginTop: 6, color: '#EAECF0', fontSize: 13 }}>Presented by {event.organizer_name}</ThemedText>
            </View>

            <View style={{ marginTop: -10, marginHorizontal: 14, padding: 15, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <InfoRow icon="◷" title={formatEventDate(event.starts_at)} detail={`Ends ${formatEventDate(event.ends_at)}`} colors={colors} />
              <InfoRow icon="⌖" title={event.venue_name} detail={event.venue_address} colors={colors} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                <Chip label={event.seating_mode === 'assigned' ? 'Assigned seating' : 'General admission'} colors={colors} />
                {event.capacity !== null && <Chip label={`${event.capacity.toLocaleString()} capacity`} colors={colors} />}
                {event.timezone && <Chip label={event.timezone} colors={colors} />}
              </View>
            </View>

            <View style={{ paddingHorizontal: 16, paddingTop: 21 }}>
              {event.description ? <>
                <ThemedText style={{ marginBottom: 8, color: colors.text, fontSize: 17, fontWeight: '800' }}>About the event</ThemedText>
                <ThemedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{event.description}</ThemedText>
              </> : null}

              {event.refund_policy ? <>
                <ThemedText style={{ marginTop: 20, marginBottom: 7, color: colors.text, fontSize: 17, fontWeight: '800' }}>Refund policy</ThemedText>
                <ThemedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{event.refund_policy}</ThemedText>
              </> : null}

              <View style={{ marginTop: event.description || event.refund_policy ? 22 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <ThemedText style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>Tickets</ThemedText>
                <ThemedText style={{ color: colors.muted, fontSize: 11 }}>{ticketTypes.length} {ticketTypes.length === 1 ? 'option' : 'options'}</ThemedText>
              </View>

              {ticketTypes.length === 0 ? (
                <View style={{ marginTop: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}><ThemedText style={{ color: colors.muted, fontSize: 13 }}>Ticket information is not available yet.</ThemedText></View>
              ) : ticketTypes.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} colors={colors} paidSalesActive={event.paid_sales_active} />)}

              {!event.paid_sales_active && ticketTypes.some((ticket) => ticket.price_minor > 0) && (
                <ThemedText style={{ marginTop: 8, color: colors.paleAccent, fontSize: 12 }}>Paid ticket sales are not open for this event yet.</ThemedText>
              )}
            </View>
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: colors.accent, opacity: 0.72 }}>
              <ThemedText style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>Ticket booking coming soon</ThemedText>
            </View>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

function InfoRow({ icon, title, detail, colors }: { icon: string; title: string; detail: string; colors: typeof palette.dark }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
      <View style={{ width: 34, height: 34, marginRight: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.raised }}><ThemedText style={{ color: colors.accent, fontSize: 17 }}>{icon}</ThemedText></View>
      <View style={{ flex: 1 }}><ThemedText style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{title}</ThemedText><ThemedText style={{ marginTop: 3, color: colors.muted, fontSize: 11 }}>{detail}</ThemedText></View>
    </View>
  );
}

function Chip({ label, colors }: { label: string; colors: typeof palette.dark }) {
  return <View style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.raised }}><ThemedText style={{ color: colors.muted, fontSize: 10 }}>{label}</ThemedText></View>;
}

function TicketCard({ ticket, colors, paidSalesActive }: { ticket: PublicTicketType; colors: typeof palette.dark; paidSalesActive: boolean }) {
  const soldOut = ticket.available <= 0;
  const unavailable = soldOut || (ticket.price_minor > 0 && !paidSalesActive);
  return (
    <View style={{ marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <View style={{ flex: 1 }}>
        <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{ticket.name}</ThemedText>
        {!!ticket.description && <ThemedText style={{ marginTop: 4, color: colors.muted, fontSize: 11 }}>{ticket.description}</ThemedText>}
        <ThemedText style={{ marginTop: 5, color: unavailable ? colors.paleAccent : colors.muted, fontSize: 11 }}>{soldOut ? 'Sold out' : `${ticket.available.toLocaleString()} available`}</ThemedText>
      </View>
      <ThemedText style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>{formatEventPrice(ticket.price_minor)}</ThemedText>
    </View>
  );
}
