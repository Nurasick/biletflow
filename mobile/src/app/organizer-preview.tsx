import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Action, Info, Panel, WorkspaceScreen, useWorkspaceColors } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { resolveEventImage } from '@/shared/api/events';
import { managementApi, type EventPreview, type ManagedTicketType, type PublishRequirementCode } from '@/shared/api/management';

const requirementLabels: Record<PublishRequirementCode, string> = {
  title: 'The event has a title',
  venue: 'Venue name and address are set',
  schedule: 'The end time is after the start time',
  future_start: 'The event starts in the future',
  visible_ticket_type: 'At least one visible ticket type exists',
};

/** SRS 4.2 / UC1: the organizer reviews what attendees will see before publishing. */
export default function OrganizerPreviewScreen() {
  const { authenticatedFetch } = useAuth();
  const { t, formatDate, locale } = useI18n();
  const colors = useWorkspaceColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Number(Array.isArray(params.eventId) ? params.eventId[0] : params.eventId);
  const [preview, setPreview] = useState<EventPreview | null>(null);
  const [types, setTypes] = useState<ManagedTicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const money = (minor: number, currency: string) => minor === 0 ? t('Free')
    : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    if (!Number.isSafeInteger(eventId) || eventId <= 0) { setError('Invalid event ID.'); setLoading(false); return; }
    setLoading(true); setError('');
    void Promise.all([
      managementApi.preview(authenticatedFetch, eventId, controller.signal),
      managementApi.ticketTypes(authenticatedFetch, eventId, controller.signal),
    ]).then(([snapshot, ticketTypes]) => {
      if (!controller.signal.aborted) { setPreview(snapshot); setTypes(ticketTypes); }
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the event preview.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authenticatedFetch, eventId, revision]));

  const publish = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await managementApi.transition(authenticatedFetch, eventId, 'publish');
      setNotice('Event published.');
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  const event = preview?.event;
  const cover = resolveEventImage(event?.cover_image_url ?? preview?.images[0]?.url);
  const blocked = preview?.publish_requirements.some((item) => !item.met) ?? true;
  const visibleTypes = types.filter((type) => !type.is_hidden);

  return (
    <WorkspaceScreen title={t('Event preview')} onRefresh={() => setRevision((value) => value + 1)} refreshing={loading}>
      {!!error && <Info tone="error">{t(error)}</Info>}
      {!!notice && <Info tone="success">{t(notice)}</Info>}
      {!!event && <>
        <Panel>
          <Info tone="muted">{event.status === 'published'
            ? t('This is how attendees see the published event.')
            : t('Preview only. Attendees cannot see this event until it is published.')}</Info>
          {!!cover && <Image source={{ uri: cover }} contentFit="cover" accessibilityLabel={t('Event image')}
            style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: colors.raised }} />}
          <Info>{event.title}</Info>
          <Info tone="muted">{formatDate(event.starts_at, event.timezone)} – {formatDate(event.ends_at, event.timezone)}</Info>
          <Info tone="muted">{event.venue_name} · {event.venue_address}</Info>
          <Info tone="muted">{t(event.category ?? 'other')} · {t(event.visibility)} · {t(event.seating_mode)}{event.capacity ? ` · ${t('Capacity')}: ${event.capacity}` : ''}</Info>
          {!!event.description && <Info>{event.description}</Info>}
          {!!event.refund_policy && <Info tone="muted">{t('Refund policy')}: {event.refund_policy}</Info>}
        </Panel>
        <Panel>
          <Info>{t('Tickets attendees can choose')}</Info>
          {visibleTypes.map((type) => (
            <View key={type.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, gap: 2 }}>
              <Info>{type.name} · {money(type.price_minor, type.currency)}</Info>
              {!!type.description && <Info tone="muted">{type.description}</Info>}
              <Info tone="muted">{t('Available')}: {type.quantity_total - type.quantity_sold - type.quantity_reserved} / {type.quantity_total}</Info>
            </View>
          ))}
          {!visibleTypes.length && <Info tone="error">{t('No visible ticket types yet.')}</Info>}
        </Panel>
        <Panel>
          <Info>{t('Ready to publish?')}</Info>
          {preview.publish_requirements.map((item) => (
            <Info key={item.code} tone={item.met ? undefined : 'error'}>{item.met ? '✓' : '✗'} {t(requirementLabels[item.code])}</Info>
          ))}
          {preview.allowed_actions.includes('publish') && (
            <Action label={t(busy ? 'Publishing…' : 'Publish event')} disabled={busy || blocked} onPress={() => void publish()} />
          )}
          {event.status === 'published' && <Action secondary label={t('Open public event page')}
            onPress={() => router.push({ pathname: '/event-details', params: { slug: event.slug } })} />}
          <Action secondary label={t('Back to event management')} onPress={() => router.back()} />
        </Panel>
      </>}
    </WorkspaceScreen>
  );
}
