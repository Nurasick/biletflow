import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Children, Fragment, useCallback, useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, type IconName } from '@/components/design';
import { WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSelector, useI18n } from '@/i18n';
import { accountApi, type Account } from '@/shared/api/account';
import { staffApi } from '@/shared/api/staff';

/** The Menu tab: account, the tools this account can use, support, language, sign out. */
export default function Workspace() {
  const router = useRouter();
  const { logout, user, authenticatedFetch } = useAuth();
  const { t } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
  const [hasStaffEvents, setHasStaffEvents] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Keyed on `user`, not just `authenticatedFetch`: that callback is stable across
  // sign-out, so without `user` here the account fetched before sign-out stayed in
  // state and the profile row kept showing the old name until a reload.
  useFocusEffect(useCallback(() => {
    if (!user) {
      setAccount(null);
      setHasStaffEvents(false);
      return undefined;
    }
    const controller = new AbortController();
    void accountApi.get(authenticatedFetch, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setAccount(value); })
      .catch(() => { if (!controller.signal.aborted) setAccount(null); });
    // Door tools only matter to people assigned to an event (organizers are listed as staff of their own events).
    void staffApi.events(authenticatedFetch, controller.signal)
      .then((events) => { if (!controller.signal.aborted) setHasStaffEvents(events.length > 0); })
      .catch(() => { if (!controller.signal.aborted) setHasStaffEvents(false); });
    return () => controller.abort();
  }, [authenticatedFetch, user]));

  const go = (href: Href) => () => router.push(user ? href : '/login');
  const name = account ? `${account.first_name} ${account.last_name}`.trim() : '';
  const canAnswerSupport = hasStaffEvents || !!account?.is_organizer || !!account?.is_platform_admin;

  return (
    <WorkspaceScreen tab="workspace" title={t('Menu')}>
      <Group>
        <ProfileRow name={name || t(user ? 'Account' : 'Sign in')} email={account?.email ?? user?.email ?? ''} onPress={go('/account')} />
      </Group>

      <Group title={t('Tickets and offers')}>
        <Row icon="scan" label={t('Scan campaign QR')} detail={t('Open an event with its promo code applied')} onPress={go('/campaign-scan')} />
        <Row icon="help" label={t('My support cases')} onPress={go('/support')} />
      </Group>

      <Group title={t('Event tools')}>
        {hasStaffEvents && <Row icon="scan" label={t('Open assigned events')} detail={t('Check tickets in at the door')} onPress={go('/staff')} />}
        <Row icon="calendar" label={t('Organizer tools')}
          detail={t(account?.is_organizer ? 'Events, sales and campaigns' : 'Become an organizer')} onPress={go('/organizer')} />
        {canAnswerSupport && <Row icon="help" label={t('Support queue')} onPress={() => router.push({ pathname: '/support', params: { mode: 'staff' } })} />}
        {account?.is_platform_admin && <Row icon="shield" label={t('Platform administration')} onPress={go('/admin')} />}
      </Group>

      <Group title={t('Language')}>
        <View style={styles.language}><LanguageSelector /></View>
      </Group>

      {Boolean(user) && (
        <Group>
          <Row icon="signOut" danger label={t(signingOut ? 'Signing out…' : 'Sign out')} disabled={signingOut} chevron={false}
            onPress={() => { setSigningOut(true); void logout().finally(() => setSigningOut(false)); }} />
        </Group>
      )}
    </WorkspaceScreen>
  );
}

/** iOS inset-grouped list section: one surface, rows divided by hairlines. */
function Group({ title, children }: PropsWithChildren<{ title?: string }>) {
  const colors = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 7 }}>
      {!!title && <AppText accessibilityRole="header" style={[styles.groupTitle, { color: colors.muted }]}>{title}</AppText>}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function Row({ icon, label, detail, onPress, danger = false, disabled = false, chevron = true }: {
  icon: IconName; label: string; detail?: string; onPress: () => void; danger?: boolean; disabled?: boolean; chevron?: boolean;
}) {
  const colors = useTheme();
  const tint = danger ? colors.danger : colors.accent;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.raised : 'transparent', opacity: disabled ? 0.55 : 1 }]}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? colors.dangerWash : colors.accentWash }]}><Icon name={icon} size={18} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <AppText style={{ color: danger ? colors.danger : colors.text, fontSize: 16, fontWeight: '700' }}>{label}</AppText>
        {!!detail && <AppText style={{ color: colors.muted, fontSize: 13 }}>{detail}</AppText>}
      </View>
      {chevron && <Icon name="chevronRight" size={15} color={colors.muted} />}
    </Pressable>
  );
}

function ProfileRow({ name, email, onPress }: { name: string; email: string; onPress: () => void }) {
  const colors = useTheme();
  const { t } = useI18n();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityHint={email ? t('Edit your account') : t('Sign in to access your tickets and orders.')} onPress={onPress}
      style={({ pressed }) => [styles.row, styles.profile, { backgroundColor: pressed ? colors.raised : 'transparent' }]}>
      <View style={[styles.avatar, { backgroundColor: colors.button }]}>
        {initials ? <AppText style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{initials}</AppText> : <Icon name="user" size={24} color="#FFFFFF" />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText numberOfLines={1} style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{name}</AppText>
        {!!email && <AppText numberOfLines={1} style={{ color: colors.muted, fontSize: 14 }}>{email}</AppText>}
      </View>
      <Icon name="chevronRight" size={15} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16 },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  profile: { minHeight: 76 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  language: { paddingHorizontal: 12, paddingVertical: 12 },
});
