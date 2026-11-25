import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ticketLimit } from '@/api/public';
import { AppText, Icon, type IconName } from '@/components/design';
import { ScreenFrame } from '@/components/screen-frame';
import { Action, Info, Panel, ScreenHeading, FormField } from '@/components/workspace';
import { MaxContentWidth } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import { openEventCalendar } from '@/shared/api/documents';
import { eventsApi, resolveEventImage, type EventCategory, type EventDetail, type PublicTicketType } from '@/shared/api/events';

const categories: Record<EventCategory, string> = { concert: 'Concerts', theater: 'Theatre', sport: 'Sports', conference: 'Conferences', other: 'Other' };

export default function EventDetailsScreen() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const { slug: rawSlug, campaignToken: rawCampaignToken } = useLocalSearchParams<{ slug?: string | string[]; campaignToken?: string | string[] }>();
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const campaignToken = Array.isArray(rawCampaignToken) ? rawCampaignToken[0] : rawCampaignToken;
  const colors = useTheme();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [ticketTypes, setTicketTypes] = useState<PublicTicketType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [accessCode,setAccessCode]=useState('');
  const [accessToken,setAccessToken]=useState('');
  const [unlockError,setUnlockError]=useState('');

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
      eventsApi.get(slug, controller.signal, accessToken),
      eventsApi.ticketTypes(slug, controller.signal, accessToken),
    ]).then(([eventInfo, types]) => {
      if (controller.signal.aborted) return;
      setEvent(eventInfo);
      setTicketTypes(types);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Could not load this event.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [slug, revision, accessToken]);

  const imageUrl = resolveEventImage(event?.cover_image_url);
  const gallery = event?.images.filter((image) => image.url !== event.cover_image_url) ?? [];
  const canBook = event?.status === 'published' && event.phase !== 'completed' && ticketTypes.some((ticket) => ticketLimit(ticket) > 0 && (ticket.price_minor === 0 || event.paid_sales_active));
  const addToCalendar = async () => {
    if (!event || calendarBusy) return;
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      await openEventCalendar(event.slug);
    } catch (failure) {
      setCalendarError(failure instanceof Error ? failure.message : 'Could not open the calendar file.');
    } finally {
      setCalendarBusy(false);
    }
  };
  const unlock=async()=>{if(!slug)return;setUnlockError('');try{const result=await eventsApi.unlock(slug,accessCode);setAccessToken(result.access_token);setAccessCode('');setRevision(value=>value+1);}catch(failure){setUnlockError(failure instanceof Error?failure.message:'Could not unlock this event.');}};

  return (
    <ScreenFrame title={t('Event details')}>
      {isLoading ? (
        <View style={styles.feedback}><ActivityIndicator color={colors.accent} /><Info tone="muted">{t('Loading event…')}</Info></View>
      ) : error ? (
        <View style={styles.feedback}>
          <Panel>
            <ScreenHeading>{t('Event unavailable')}</ScreenHeading>
            <Info tone="error">{t(error)}</Info>
            {slug&&!accessToken&&<><FormField label={t('Private event access code')} value={accessCode} onChangeText={setAccessCode} autoCapitalize="none"/><Action label={t('Unlock event')} disabled={!accessCode.trim()} onPress={()=>void unlock()}/>{!!unlockError&&<Info tone="error">{t(unlockError)}</Info>}</>}
            {slug && <Action secondary label={t('Try again')} onPress={() => setRevision((value) => value + 1)} />}
            <Action secondary label={t('Back to events')} onPress={() => router.dismissTo('/')} />
          </Panel>
        </View>
      ) : event ? (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
            {imageUrl && (
              <View style={[styles.cover, { backgroundColor: colors.raised }]}>
                <Image source={{ uri: imageUrl }} contentFit="contain" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
              </View>
            )}
            <View style={styles.intro}>
              <View style={[styles.badge, { backgroundColor: colors.accentWash }]}>
                <Icon name="ticket" color={colors.accent} size={17} />
                <AppText style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>{t(categories[event.category ?? 'other'])}</AppText>
              </View>
              <ScreenHeading>{event.title}</ScreenHeading>
              <Info tone="muted">{t('Presented by')} {event.organizer_name}</Info>
              {event.phase === 'completed' && <Info tone="muted">{t('Completed')}</Info>}
              {event.status === 'cancelled' && <Info tone="error">{t('Cancelled')}</Info>}
              {event.status === 'suspended' && <Info tone="error">{t('Suspended')}</Info>}
            </View>
            <Panel>
              {event.visibility==='private'&&!accessToken&&<><Info>{t('Private event')}</Info><FormField label={t('Access code')} value={accessCode} onChangeText={setAccessCode} autoCapitalize="none"/><Action label={t('Unlock event')} disabled={!accessCode.trim()} onPress={()=>void unlock()}/>{!!unlockError&&<Info tone="error">{t(unlockError)}</Info>}</>}
              <InfoRow icon="calendar" title={formatDate(event.starts_at, event.timezone)}
                detail={t('Ends {date}', { date: formatDate(event.ends_at, event.timezone) })} />
              <InfoRow icon="location" title={event.venue_name} detail={event.venue_address} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                <Chip label={t(event.seating_mode === 'assigned' ? 'Assigned seating' : 'General admission')} />
                {event.capacity !== null && <Chip label={t('{count} capacity', { count: formatNumber(event.capacity) })} />}
                <Chip label={event.timezone} />
              </View>
              <Action secondary icon="calendar" disabled={calendarBusy}
                label={t(calendarBusy ? 'Preparing calendar file…' : 'Add to calendar (.ics)')} onPress={() => void addToCalendar()} />
              {event.calendar_links&&<><Action secondary label={t('Add to Google Calendar')} onPress={()=>void import('expo-linking').then(({openURL})=>openURL(event.calendar_links!.google))}/><Action secondary label={t('Add to Outlook Calendar')} onPress={()=>void import('expo-linking').then(({openURL})=>openURL(event.calendar_links!.outlook))}/></>}
              {calendarError && <Info tone="error">{t(calendarError)}</Info>}
            </Panel>
            {!!event.description && <Panel><SectionTitle>{t('About the event')}</SectionTitle><Info tone="muted">{event.description}</Info></Panel>}
            {gallery.length > 0 && <View style={styles.gallery}>
              {gallery.map((image) => <Image key={image.id} source={{ uri: resolveEventImage(image.url) }} contentFit="cover"
                accessibilityIgnoresInvertColors style={[styles.galleryImage, { backgroundColor: colors.raised }]} />)}
            </View>}
            <Panel>
              <SectionTitle>{t('Tickets')}</SectionTitle>
              {ticketTypes.length === 0
                ? <Info tone="muted">{t('Ticket information is not available yet.')}</Info>
                : ticketTypes.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}
              {!event.paid_sales_active && ticketTypes.some((ticket) => ticket.price_minor > 0) && (
                <Info tone="muted">{t('Paid ticket sales are not open for this event yet.')}</Info>
              )}
            </Panel>
            {!!event.refund_policy && <Panel><SectionTitle>{t('Refund policy')}</SectionTitle><Info tone="muted">{event.refund_policy}</Info></Panel>}
            <Action secondary icon="help" label={t('Contact support')} onPress={() => router.push(isLoggedIn ? { pathname: '/support-new', params: { eventId: String(event.id) } } : '/login')} />
            <Action secondary label={t('Report this event')} onPress={() => router.push(isLoggedIn ? { pathname: '/report-event', params: { slug: event.slug } } : '/login')} />
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.footerContent}>
              <Action icon="ticket" disabled={!canBook||(event.visibility==='private'&&!accessToken)} label={t(canBook ? 'Choose tickets' : 'Booking unavailable')}
                onPress={() => router.push({ pathname: event.seating_mode === 'assigned' ? '/seat-selection' : '/ticket-selection', params: { slug: event.slug, ...(accessToken?{accessToken}:{}), ...(campaignToken ? { campaignToken } : {}) } })} />
            </View>
          </View>
        </>
      ) : null}
    </ScreenFrame>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const colors = useTheme();
  return <AppText accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 }}>{children}</AppText>;
}

function InfoRow({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  const colors = useTheme();
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: colors.accentWash }]}><Icon name={icon} color={colors.accent} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{title}</AppText>
        <AppText style={{ color: colors.muted, fontSize: 12 }}>{detail}</AppText>
      </View>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const colors = useTheme();
  return <View style={[styles.chip, { backgroundColor: colors.raised }]}><AppText style={{ color: colors.muted, fontSize: 11 }}>{label}</AppText></View>;
}

function TicketCard({ ticket }: { ticket: PublicTicketType }) {
  const { t, formatNumber, locale } = useI18n();
  const colors = useTheme();
  const soldOut = ticket.available <= 0;
  const price = ticket.price_minor === 0 ? t('Free') : new Intl.NumberFormat(locale, { style: 'currency', currency: ticket.currency }).format(ticket.price_minor / 100);
  return (
    <View style={[styles.ticket, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{ticket.name}</AppText>
        {!!ticket.description && <AppText style={{ color: colors.muted, fontSize: 12 }}>{ticket.description}</AppText>}
        <AppText style={{ color: soldOut ? colors.warning : colors.muted, fontSize: 12 }}>{soldOut ? t('Sold out') : t('{count} available', { count: formatNumber(ticket.available) })}</AppText>
      </View>
      <AppText style={{ color: colors.accent, fontSize: 14, fontWeight: '800' }}>{price}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  feedback: { flex: 1, alignSelf: 'center', justifyContent: 'center', alignItems: 'center', padding: 20, gap: 10, maxWidth: MaxContentWidth },
  content: { alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth, padding: 18, paddingBottom: 24, gap: 14 },
  cover: { aspectRatio: 1.68, overflow: 'hidden', borderRadius: 20 },
  intro: { gap: 8, paddingVertical: 2 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryImage: { flexGrow: 1, flexBasis: '45%', aspectRatio: 1.5, borderRadius: 13 },
  ticket: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderRadius: 13, padding: 12 },
  footer: { borderTopWidth: 1 },
  footerContent: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 9 },
});
