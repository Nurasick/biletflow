import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { notificationsApi, notificationTitles, type NotificationFeed } from '@/shared/api/notifications';

export default function Notifications() {
  const { authenticatedFetch } = useAuth();
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      running = true;
      setLoading(true);
      try {
        const result = await notificationsApi.list(authenticatedFetch, controller.signal);
        if (active) { setFeed(result); setError(''); }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load notifications.');
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; controller.abort(); clearInterval(timer); listener.remove(); };
  }, [authenticatedFetch, revision]));

  const markRead = async () => {
    if (marking) return;
    setMarking(true);
    try { await notificationsApi.markRead(authenticatedFetch); setRevision(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not mark notifications as read.'); }
    finally { setMarking(false); }
  };
  return <WorkspaceScreen title={t('Notifications')} onRefresh={() => setRevision(value => value + 1)} refreshing={loading}>
    {!!(error) && <Info tone="error">{t(error)}</Info>}
    {!!(!feed && loading) && <Info>{t('Loading…')}</Info>}
    <Action secondary label={t('Refresh')} onPress={() => setRevision(value => value + 1)} disabled={loading} />
    {!!(feed) && <>
      <Info>{t('Unread: {count}', { count: feed.unread })}</Info>
      <Action label={t(marking ? 'Marking as read…' : 'Mark all read')} disabled={marking || !feed.unread} onPress={() => void markRead()} />
      {!feed.items.length && <Info>{t('No notifications yet.')}</Info>}
      {feed.items.map(item => {
        const payload = item.payload;
        return <Panel key={item.id}>
          <Info>{`${item.read_at ? '' : '● '}${t(notificationTitles[item.template_key] ?? 'Notification')}`}</Info>
          {!!(typeof payload.event_title === 'string') && <Info>{payload.event_title}</Info>}
          {!!(typeof payload.order_number === 'string') && <Info>{payload.order_number}</Info>}
          {!!(typeof payload.case_number === 'string') && <Info>{payload.case_number}</Info>}
          <Info tone="muted">{formatDate(item.created_at)}</Info>
          {item.template_key.startsWith('support.') ? <Action secondary label={t('Open support')} onPress={() => router.push('/support')} />
            : <Action secondary label={t('View orders')} onPress={() => router.push('/tickets')} />}
        </Panel>;
      })}
    </>}
  </WorkspaceScreen>;
}
