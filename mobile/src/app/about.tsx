import { useRouter } from 'expo-router';

import { Wordmark } from '@/components/design';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useI18n } from '@/i18n';

export default function About() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <WorkspaceScreen title={t('About BiletFlow')}>
      <Panel>
        <Wordmark />
        <Info>{t('Discover events, get tickets, and keep your orders together.')}</Info>
      </Panel>
      <Action label={t('Browse events')} onPress={() => router.dismissTo('/')} />
    </WorkspaceScreen>
  );
}
