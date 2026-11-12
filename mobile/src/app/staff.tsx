import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { staffApi, type StaffEvent } from '@/shared/api/staff';

export default function StaffEventsScreen() {
  const router = useRouter();
  const { authenticatedFetch } = useAuth();
  const { t, formatDate } = useI18n();
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async (showLoading = false) => {
      if (inFlight || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      inFlight = true;
      if (showLoading) setLoading(true);
      try {
        const data = await staffApi.events(authenticatedFetch, controller.signal);
        if (!controller.signal.aborted) {
          setEvents(data);
          setError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Request failed. Check your connection.');
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load(true);
    const timer = setInterval(() => void load(), 30_000);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { controller.abort(); clearInterval(timer); appState.remove(); };
  }, [authenticatedFetch, refreshKey]));

  return (
    <WorkspaceScreen title={t('Staff check-in')} refreshing={loading} onRefresh={() => setRefreshKey(key => key + 1)}>
      <Info>{t('Only events assigned to your account appear here.')}</Info>
      {!!(loading && events.length === 0) && <Info>{t('Loading assigned events...')}</Info>}
      {error ? <Panel><Info tone="error">{t(error)}</Info><Action label={t('Retry')} onPress={() => setRefreshKey(key => key + 1)} /></Panel> : events.map(event => (
        <Panel key={event.id}>
          <Info>{event.title}</Info>
          <Info tone="muted">{event.venue_name}</Info>
          <Info tone="muted">{formatDate(event.starts_at, event.timezone)}</Info>
          <Info tone="muted">{t(event.role === 'organizer' ? 'Organizer' : 'Event admin')} / {t(event.status)}</Info>
          <Action label={t('Open check-in')} onPress={() => router.push({ pathname: '/staff-event', params: { eventId: String(event.id) } })} />
        </Panel>
      ))}
      {!!(!loading && !error && events.length === 0) && <Panel><Info>{t('No assigned events')}</Info><Info tone="muted">{t('Ask the organizer to assign you to an event.')}</Info></Panel>}
      <Action label={t('Refresh')} secondary onPress={() => setRefreshKey(key => key + 1)} disabled={loading} />
    </WorkspaceScreen>
  );
}
