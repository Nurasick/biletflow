import { useRouter } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Icon, Wordmark } from '@/components/design';
import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';

/** The top-level sections; the floating tab bar in app/(tabs)/_layout.tsx switches between them. */
export type PrimaryTab = 'events' | 'tickets' | 'workspace';

export function ScreenFrame({ children, tab, title, onBack }: PropsWithChildren<{
  tab?: PrimaryTab; title?: string; onBack?: () => void;
}>) {
  const colors = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const goBack = onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/'));

  return (
    // Tab screens leave the bottom edge to the floating bar so content scrolls underneath it.
    <SafeAreaView edges={tab ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <View style={styles.header}>
          {tab ? (
            <>
              <View style={{ paddingLeft: 6 }}><Wordmark /></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Notifications')} onPress={() => router.push('/notifications')}
                style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.raised : 'transparent' }]}>
                <Icon name="bell" color={colors.text} size={22} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={goBack} hitSlop={6}
                style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.raised : 'transparent' }]}>
                <Icon name="arrowLeft" color={colors.accent} size={22} />
              </Pressable>
              <AppText numberOfLines={1} style={{ flex: 1, flexShrink: 1, color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</AppText>
            </>
          )}
        </View>
      </View>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', minHeight: 56, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
