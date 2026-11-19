import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, type IconName } from '@/components/design';
import { Action, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSelector, useI18n } from '@/i18n';
import { accountApi, type Account } from '@/shared/api/account';

export default function Workspace() {
  const router = useRouter();
  const colors = useTheme();
  const { logout, user, authenticatedFetch } = useAuth();
  const { t } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void accountApi.get(authenticatedFetch, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setAccount(value); })
      .catch(() => { if (!controller.signal.aborted) setAccount(null); });
    return () => controller.abort();
  }, [authenticatedFetch]));

  return (
    <WorkspaceScreen tab="workspace" title={t('Workspace')}>
      <Panel>
        <WorkspaceLink icon="user" label={account ? `${account.first_name} ${account.last_name}` : t('Account')}
          detail={user?.email} onPress={() => router.push('/account')} />
      </Panel>
      <Panel>
        <AppText accessibilityRole="header" style={[styles.groupTitle, { color: colors.text }]}>{t('Event tools')}</AppText>
        <WorkspaceLink icon="scan" label={t('Open assigned events')} detail={t('Event staff')} onPress={() => router.push('/staff')} />
        <WorkspaceLink icon="calendar" label={t('Organizer tools')} onPress={() => router.push('/organizer')} />
        <WorkspaceLink icon="ticket" label={t('Scan campaign QR')} onPress={() => router.push('/campaign-scan')} />
        {account?.is_platform_admin && <WorkspaceLink icon="shield" label={t('Platform administration')} onPress={() => router.push('/admin')} />}
      </Panel>
      <Panel>
        <AppText accessibilityRole="header" style={[styles.groupTitle, { color: colors.text }]}>{t('Support')}</AppText>
        <WorkspaceLink icon="help" label={t('My support cases')} onPress={() => router.push('/support')} />
        <WorkspaceLink icon="help" label={t('Support queue')} onPress={() => router.push({ pathname: '/support', params: { mode: 'staff' } })} />
      </Panel>
      <Panel>
        <AppText accessibilityRole="header" style={[styles.groupTitle, { color: colors.text }]}>{t('Language')}</AppText>
        <LanguageSelector />
      </Panel>
      <Action danger disabled={signingOut} label={t(signingOut ? 'Signing out…' : 'Sign out')}
        onPress={() => { setSigningOut(true); void logout().finally(() => setSigningOut(false)); }} />
    </WorkspaceScreen>
  );
}

function WorkspaceLink({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.link, { borderColor: colors.border, backgroundColor: pressed ? colors.raised : colors.surface }]}>
      <View style={[styles.icon, { backgroundColor: colors.accentWash }]}><Icon name={icon} size={21} color={colors.accent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{label}</AppText>
        {detail && <AppText style={{ color: colors.muted, fontSize: 12 }}>{detail}</AppText>}
      </View>
      <Icon name="arrowUpRight" color={colors.accent} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 13, padding: 8, minHeight: 51 },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
