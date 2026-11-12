import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { accountApi, type Account } from '@/shared/api/account';

import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';

export default function Workspace() {
  const router = useRouter();
  const { logout, user, authenticatedFetch } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void accountApi.get(authenticatedFetch, controller.signal).then(setAccount).catch(() => setAccount(null));
    return () => controller.abort();
  }, [authenticatedFetch]));
  return <WorkspaceScreen title={t('Workspace')}>
    <Info>{user?.email}</Info>
    <Panel>
      <Info>{t('Event staff')}</Info>
      <Info tone="muted">{t('Scan tickets and manage entry for your assigned events.')}</Info>
      <Action label={t('Open assigned events')} onPress={() => router.push('/staff')} />
    </Panel>
    <Panel>
      <Info>{t('Organizer tools')}</Info>
      <Info tone="muted">{t('Create and manage events, ticket inventory, campaigns, sales, and reports.')}</Info>
      <Action label={t('Open organizer workspace')} onPress={() => router.push('/organizer')} />
      <Action secondary label={t('Scan campaign QR')} onPress={() => router.push('/campaign-scan')} />
    </Panel>
    {account?.is_platform_admin && <Panel>
      <Info>{t('Platform administration')}</Info>
      <Info tone="muted">{t('Review events, accounts, transactions, activations, reports, and platform settings.')}</Info>
      <Action label={t('Open admin workspace')} onPress={() => router.push('/admin')} />
    </Panel>}
    <Panel>
      <Info>{t('Support')}</Info>
      <Action label={t('My support cases')} onPress={() => router.push('/support')} />
      <Action secondary label={t('Support queue')} onPress={() => router.push({ pathname: '/support', params: { mode: 'staff' } })} />
    </Panel>
    <Action secondary label={t('Notifications')} onPress={() => router.push('/notifications')} />
    <Action secondary label={t('Account')} onPress={() => router.push('/account')} />
    <Panel>
      <Info>{t('Language')}</Info>
      {(['en', 'kk', 'ru'] as const).map(value => <Action key={value} secondary={value !== locale}
        label={`${locale === value ? '✓ ' : ''}${value === 'kk' ? 'Қазақша' : value === 'ru' ? 'Русский' : 'English'}`}
        onPress={() => setLocale(value)} />)}
    </Panel>
    <Action danger disabled={signingOut} label={t(signingOut ? 'Signing out…' : 'Sign out')}
      onPress={() => { setSigningOut(true); void logout().finally(() => setSigningOut(false)); }} />
  </WorkspaceScreen>;
}
