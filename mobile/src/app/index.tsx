import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { eventsApi, formatEventDate, resolveEventImage, type EventCategory, type PublicEvent } from '@/shared/api/events';

const CATEGORIES: { label: string; value?: EventCategory; icon: string }[] = [
  { label: 'All', icon: '✦' },
  { label: 'Concerts', value: 'concert', icon: '♫' },
  { label: 'Theatre', value: 'theater', icon: '◉' },
  { label: 'Sports', value: 'sport', icon: '◎' },
  { label: 'Conferences', value: 'conference', icon: '◇' },
  { label: 'Other', value: 'other', icon: '✧' },
];

const palette = {
  dark: { background: '#101828', surface: '#182230', raised: '#1D2939', border: '#344054', text: '#F5F5F0', muted: '#98A2B3', accent: '#FF5C35', paleAccent: '#FFA38B' },
  light: { background: '#F5F5F0', surface: '#FFFFFF', raised: '#F9FAF7', border: '#D0D5DD', text: '#101828', muted: '#667085', accent: '#D9431F', paleAccent: '#A93216' },
};

export default function HomeScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? palette.dark : palette.light;
  const [activeCategory, setActiveCategory] = useState<EventCategory | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      setError(null);
      void eventsApi.list({ q: searchQuery, category: activeCategory, limit: 50 }, controller.signal)
        .then(setEvents)
        .catch((requestError: unknown) => {
          if (requestError instanceof Error && requestError.name === 'AbortError') return;
          setError(requestError instanceof Error ? requestError.message : 'Could not load events.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, searchQuery ? 300 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeCategory, refreshKey, searchQuery]);

  const featured = events[0];
  const remainingEvents = useMemo(() => featured ? events.slice(1) : events, [events, featured]);
  const openEvent = (event: PublicEvent) => router.push(`/event-details?slug=${encodeURIComponent(event.slug)}`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isLoading && events.length > 0} onRefresh={() => setRefreshKey((key) => key + 1)} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 15, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ width: 22, height: 27, backgroundColor: colors.accent, borderRadius: 5 }} />
              <ThemedText style={{ fontSize: 21, fontWeight: '800', color: colors.text }}>Bilet<ThemedText style={{ color: colors.accent }}>Flow</ThemedText></ThemedText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open my tickets" onPress={() => router.push('/tickets')} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
              <ThemedText style={{ color: colors.accent, fontSize: 15 }}>▣</ThemedText>
              <ThemedText style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>My tickets</ThemedText>
            </Pressable>
          </View>
          <ThemedText style={{ marginTop: 18, marginBottom: 11, color: colors.muted, fontSize: 12, fontWeight: '600' }}>Find your next event</ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }}>
            <ThemedText style={{ marginRight: 8, color: colors.muted, fontSize: 18 }}>⌕</ThemedText>
            <TextInput
              accessibilityLabel="Search events and venues"
              placeholder="Search events or venues…"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 13 }}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSearchQuery('')}><ThemedText style={{ padding: 4, color: colors.muted }}>×</ThemedText></Pressable>}
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingVertical: 14 }}>
          {CATEGORIES.map((category) => {
            const selected = category.value === activeCategory;
            return (
              <Pressable
                key={category.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setActiveCategory(category.value)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 22, borderWidth: 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : colors.surface }}>
                <ThemedText style={{ color: selected ? '#FFFFFF' : colors.accent, fontSize: 14 }}>{category.icon}</ThemedText>
                <ThemedText style={{ color: selected ? '#FFFFFF' : colors.text, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{category.label}</ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingTop: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <ThemedText style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{searchQuery || activeCategory ? 'Search results' : 'Upcoming events'}</ThemedText>
            <ThemedText style={{ color: colors.muted, fontSize: 11 }}>{events.length} found</ThemedText>
          </View>

          {isLoading && events.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 48 }}><ActivityIndicator color={colors.accent} /><ThemedText style={{ marginTop: 12, color: colors.muted, fontSize: 13 }}>Loading events…</ThemedText></View>
          )}

          {error && (
            <View style={{ alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 18 }}>
              <ThemedText style={{ color: colors.text, textAlign: 'center', fontSize: 13 }}>{error}</ThemedText>
              <Pressable onPress={() => setRefreshKey((key) => key + 1)} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.accent }}><ThemedText style={{ color: '#FFFFFF', fontWeight: '700' }}>Try again</ThemedText></Pressable>
            </View>
          )}

          {!isLoading && !error && events.length === 0 && (
            <View style={{ alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 24 }}>
              <ThemedText style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>No events found</ThemedText>
              <ThemedText style={{ marginTop: 6, color: colors.muted, textAlign: 'center', fontSize: 12 }}>Try another search or category. Published events will appear here.</ThemedText>
            </View>
          )}

          {featured && !error && (
            <Pressable onPress={() => openEvent(featured)} style={{ minHeight: 176, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              {featured.cover_image_url && <Image source={{ uri: resolveEventImage(featured.cover_image_url) }} contentFit="cover" transition={180} style={{ position: 'absolute', width: '100%', height: '100%' }} />}
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#0C111D', opacity: featured.cover_image_url ? 0.5 : 0.12 }} />
              <View style={{ padding: 16 }}>
                <ThemedText style={{ marginBottom: 7, color: colors.paleAccent, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>FEATURED</ThemedText>
                <ThemedText numberOfLines={2} style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{featured.title}</ThemedText>
                <ThemedText numberOfLines={1} style={{ marginTop: 7, color: '#EAECF0', fontSize: 12 }}>{formatEventDate(featured.starts_at)} · {featured.venue_name}</ThemedText>
              </View>
            </Pressable>
          )}

          {remainingEvents.length > 0 && (
            <View style={{ marginTop: 21 }}>
              <ThemedText style={{ marginBottom: 11, color: colors.text, fontSize: 17, fontWeight: '800' }}>More events</ThemedText>
              {remainingEvents.map((event) => (
                <EventRow key={event.id} event={event} colors={colors} onPress={() => openEvent(event)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EventRow({ event, colors, onPress }: { event: PublicEvent; colors: typeof palette.dark; onPress: () => void }) {
  const image = resolveEventImage(event.cover_image_url);
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 9, padding: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <View style={{ width: 64, height: 68, marginRight: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.raised }}>
        {image ? <Image source={{ uri: image }} contentFit="cover" transition={150} style={{ width: '100%', height: '100%' }} /> : <ThemedText style={{ color: colors.accent, fontSize: 25 }}>♫</ThemedText>}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{event.title}</ThemedText>
        <ThemedText numberOfLines={1} style={{ marginTop: 5, color: colors.muted, fontSize: 11 }}>{formatEventDate(event.starts_at)}</ThemedText>
        <ThemedText numberOfLines={1} style={{ marginTop: 3, color: colors.muted, fontSize: 11 }}>{event.venue_name}</ThemedText>
      </View>
      <ThemedText style={{ marginLeft: 8, color: colors.accent, fontSize: 17, fontWeight: '700' }}>›</ThemedText>
    </Pressable>
  );
}
