import { useRouter, type Href } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Icon, Wordmark, type IconName } from '@/components/design';
import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';

const tabs = [
  { name: 'events', label: 'Events', icon: 'discover', href: '/' },
  { name: 'tickets', label: 'My tickets', icon: 'ticket', href: '/tickets' },
  { name: 'workspace', label: 'Menu', icon: 'menu', href: '/workspace' },
] as const satisfies readonly { name: string; label: string; icon: IconName; href: Href }[];

export type PrimaryTab = typeof tabs[number]['name'];

export function ScreenFrame({ children, tab, title, onBack }: PropsWithChildren<{
  tab?: PrimaryTab; title?: string; onBack?: () => void;
}>) {
  const colors = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const goBack = onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={styles.header}>
          {tab ? (
            <>
              <Wordmark />
              <Pressable accessibilityRole="button" accessibilityLabel={t('Notifications')} onPress={() => router.push('/notifications')}
                style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, backgroundColor: pressed ? colors.raised : colors.surface }]}>
                <Icon name="bell" color={colors.text} size={21} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={goBack}
                style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, backgroundColor: pressed ? colors.raised : colors.surface }]}>
                <Icon name="arrowLeft" color={colors.accent} />
              </Pressable>
              <AppText style={{ flex: 1, flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' }}>{title}</AppText>
            </>
          )}
        </View>
      </View>
      {children}
      {tab && (
        <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={styles.tabs}>
            {tabs.map((item) => {
              const selected = item.name === tab;
              return (
                <Pressable key={item.name} accessibilityRole="button" accessibilityLabel={t(item.label)} accessibilityState={{ selected }}
                  onPress={() => {
                    if (selected) return;
                    if (tab === 'events') router.push(item.href);
                    else router.dismissTo(item.href);
                  }}
                  style={({ pressed }) => [styles.tab, { backgroundColor: selected ? colors.accentWash : pressed ? colors.raised : colors.surface }]}>
                  <Icon name={item.icon} color={selected ? colors.accent : colors.muted} size={20} />
                  <AppText style={{ color: selected ? colors.accent : colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{t(item.label)}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', minHeight: 62, paddingHorizontal: 18, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  iconButton: { width: 44, height: 44, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', gap: 7 },
  tab: { flex: 1, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 3, paddingVertical: 4 },
});
