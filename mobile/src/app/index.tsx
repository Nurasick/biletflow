import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { AppText, Icon, TicketArtwork, type IconName } from '@/components/design';
import { ScreenFrame } from '@/components/screen-frame';
import { Action, Info, Panel } from '@/components/workspace';
import { Fonts, MaxContentWidth, Stage } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import { eventsApi, resolveEventImage, type EventCategory, type PublicEvent } from '@/shared/api/events';

const categories: { label: string; value?: EventCategory }[] = [
  { label: 'All' },
  { label: 'Concerts', value: 'concert' },
  { label: 'Theatre', value: 'theater' },
  { label: 'Sports', value: 'sport' },
  { label: 'Conferences', value: 'conference' },
  { label: 'Other', value: 'other' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { t, formatNumber } = useI18n();
  const colors = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const [activeCategory, setActiveCategory] = useState<EventCategory>();
  const [searchQuery, setSearchQuery] = useState('');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const filtered = Boolean(searchQuery.trim() || activeCategory);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void eventsApi.list({ q: searchQuery.trim(), category: activeCategory, limit: 50 }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setEvents(result); })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Could not load events.');
        })
        .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    }, searchQuery ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeCategory, refreshKey, searchQuery]);

  const featured = !filtered ? events.find((event) => event.cover_image_url) : undefined;
  const listed = featured ? events.filter((event) => event.id !== featured.id) : events;
  const refresh = () => setRefreshKey((key) => key + 1);
  const clearFilters = () => { setSearchQuery(''); setActiveCategory(undefined); };
  const openEvent = (event: PublicEvent) => router.push({ pathname: '/event-details', params: { slug: event.slug } });
  const showArtwork = width >= 365 && fontScale < 1.3;

  return (
    <ScreenFrame tab="events">
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading && events.length > 0 && !filtered} onRefresh={refresh} tintColor={colors.accent} colors={[colors.button]} />}>
        <View style={styles.hero}>
          {showArtwork && (
            <View pointerEvents="none" style={styles.heroDecoration}>
              <View style={styles.heroRing} />
              <View style={[styles.heroRing, { margin: 17 }]} />
              <View style={{ transform: [{ scale: 0.62 }, { rotate: '4deg' }] }}><TicketArtwork /></View>
            </View>
          )}
          <AppText accessibilityRole="header" style={[styles.heroTitle, showArtwork && { maxWidth: '70%' }]}>
            {t('Find your next event')}
          </AppText>
        </View>

        <View style={[styles.search, { borderColor: focused ? colors.accent : colors.border, backgroundColor: colors.surface }]}>
          <Icon name="search" color={colors.accent} size={22} />
          <TextInput
            accessibilityLabel={t('Search events and venues')}
            placeholder={t('Search events or venues…')}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {searchQuery.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Clear search')} style={styles.clearButton} onPress={() => setSearchQuery('')}>
              <Icon name="close" color={colors.muted} size={18} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
          {categories.map(({ value, label }) => {
            const selected = value === activeCategory;
            return (
              <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setActiveCategory(value)}
                style={({ pressed }) => [styles.filter, {
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentWash : pressed ? colors.raised : colors.surface,
                }]}>
                <AppText style={{ color: selected ? colors.accent : colors.text, fontSize: 13, fontWeight: '700' }}>{t(label)}</AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.sectionHeading}>
          <AppText accessibilityRole="header" style={{ flexShrink: 1, color: colors.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.8 }}>
            {t(filtered ? 'Search results' : 'Upcoming events')}
          </AppText>
          {!isLoading && !error && events.length > 0 && <AppText style={{ color: colors.muted, fontSize: 12 }}>{formatNumber(events.length)} {t('found')}</AppText>}
        </View>
        {isLoading ? (
          <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={colors.accent} /><Info tone="muted">{t('Loading events…')}</Info></View>
        ) : error ? (
          <CatalogueFeedback icon="help" title={t('Could not load events.')} detail={t(error)}
            action={<Action secondary label={t('Try again')} onPress={refresh} />} />
        ) : events.length === 0 ? (
          <CatalogueFeedback icon={filtered ? 'search' : 'ticket'} title={t('No events found')}
            detail={t(filtered ? 'Try another search or category.' : 'Published events will appear here.')}
            action={filtered ? <Action secondary label={t('Clear filters')} onPress={clearFilters} /> : undefined} />
        ) : (
          <View style={{ gap: 11 }}>
            {featured && <EventCard event={featured} featured onPress={() => openEvent(featured)} />}
            {listed.map((event) => <EventCard key={event.id} event={event} onPress={() => openEvent(event)} />)}
          </View>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

function CatalogueFeedback({ icon, title, detail, action }: { icon: IconName; title: string; detail: string; action?: React.ReactNode }) {
  const colors = useTheme();
  return (
    <Panel>
      <View style={{ alignItems: 'center', gap: 9, paddingVertical: 6 }}>
        <View style={[styles.feedbackIcon, { backgroundColor: colors.accentWash }]}><Icon name={icon} color={colors.accent} size={25} /></View>
        <AppText style={{ textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '800' }}>{title}</AppText>
        {detail !== title && <AppText style={{ textAlign: 'center', color: colors.muted, fontSize: 14, lineHeight: 21 }}>{detail}</AppText>}
      </View>
      {action}
    </Panel>
  );
}

function EventCard({ event, featured = false, onPress }: { event: PublicEvent; featured?: boolean; onPress: () => void }) {
  const colors = useTheme();
  const { t, formatDate } = useI18n();
  const image = resolveEventImage(event.cover_image_url);
  const category = categories.find(({ value }) => value && value === event.category)?.label;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.card, !featured && styles.cardRow, { borderColor: pressed ? colors.accent : colors.border, backgroundColor: colors.surface }]}>
      <View style={[featured ? styles.cover : styles.thumbnail, { backgroundColor: colors.accentWash }]}>
        {image ? <Image source={{ uri: image }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
          : <Icon name="event" color={colors.accent} size={24} />}
      </View>
      <View style={[styles.cardContent, featured && { paddingHorizontal: 14, paddingVertical: 13 }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
            {formatDate(event.starts_at, event.timezone)}{featured && category ? ` · ${t(category)}` : ''}
          </AppText>
          <AppText style={{ color: colors.text, fontSize: featured ? 20 : 16, fontWeight: '800', letterSpacing: featured ? -0.55 : -0.3 }}>{event.title}</AppText>
          <AppText style={{ color: colors.muted, fontSize: 12 }}>{event.venue_name}</AppText>
        </View>
        <View style={[styles.cardArrow, { backgroundColor: colors.accentWash }]}>
          <Icon name="arrowUpRight" color={colors.accent} size={17} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: 18, paddingBottom: 26, gap: 13 },
  hero: { justifyContent: 'center', minHeight: 138, paddingHorizontal: 18, paddingVertical: 20, overflow: 'hidden', borderRadius: 22, backgroundColor: Stage.background },
  heroTitle: { color: Stage.accent, fontSize: 35, lineHeight: 37, letterSpacing: -1.7, fontWeight: '800' },
  heroDecoration: { position: 'absolute', right: -47, top: -9, bottom: -9, justifyContent: 'center', opacity: 0.92 },
  heroRing: { position: 'absolute', right: 4, top: -34, width: 219, height: 219, borderRadius: 110, borderWidth: 1, borderColor: Stage.lines },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 52, paddingHorizontal: 12, borderWidth: 1, borderRadius: 14 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontFamily: Fonts.sans, fontSize: 16 },
  clearButton: { width: 44, height: 44, marginRight: -6, justifyContent: 'center', alignItems: 'center' },
  filters: { gap: 7, paddingVertical: 1, paddingRight: 12 },
  filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 40 },
  card: { overflow: 'hidden', borderRadius: 18, borderWidth: 1 },
  cardRow: { padding: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  cover: { aspectRatio: 2.05, overflow: 'hidden' },
  thumbnail: { width: 68, height: 68, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardArrow: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  feedbackIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
