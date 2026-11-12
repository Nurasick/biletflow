import type { PropsWithChildren } from 'react';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';

export function useWorkspaceColors() {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark'
    ? { background: '#101828', surface: '#182230', border: '#475467', text: '#F9FAFB', muted: '#D0D5DD', accent: '#FFB199', button: '#B92E10', danger: '#FDA29B', success: '#75E0A7' }
    : { background: '#F5F5F0', surface: '#FFFFFF', border: '#98A2B3', text: '#101828', muted: '#475467', accent: '#B92E10', button: '#B92E10', danger: '#B42318', success: '#027A48' };
}

export function WorkspaceScreen({ title, children, onRefresh, refreshing = false }: PropsWithChildren<{
  title: string; onRefresh?: () => void; refreshing?: boolean;
}>) {
  const router = useRouter();
  const colors = useWorkspaceColors();
  const { t } = useI18n();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} hitSlop={8}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.back}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>{t('Back')}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Panel({ children }: PropsWithChildren) {
  const colors = useWorkspaceColors();
  return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>;
}

export function Info({ children, tone }: PropsWithChildren<{ tone?: 'muted' | 'error' | 'success' }>) {
  const colors = useWorkspaceColors();
  return <Text accessibilityLiveRegion={tone === 'error' ? 'polite' : 'none'} style={{ fontSize: 15, lineHeight: 23, color: tone === 'error' ? colors.danger : tone === 'success' ? colors.success : tone === 'muted' ? colors.muted : colors.text }}>{children}</Text>;
}

export function Action({ label, onPress, disabled = false, secondary = false, danger = false }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean;
}) {
  const colors = useWorkspaceColors();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, { borderColor: danger ? colors.danger : colors.accent, backgroundColor: secondary || danger ? colors.surface : colors.button, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
      <Text style={{ color: danger ? colors.danger : secondary ? colors.accent : '#FFFFFF', textAlign: 'center', fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function FormField({ label, style, ...props }: TextInputProps & { label: string }) {
  const colors = useWorkspaceColors();
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted}
      style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }, style]} {...props} />
  </View>;
}

const styles = StyleSheet.create({
  header: { padding: 18, borderBottomWidth: 1, gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 16 },
  title: { fontSize: 26, fontWeight: '800' },
  content: { padding: 18, paddingBottom: 40, gap: 16 },
  panel: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  action: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 14, justifyContent: 'center' },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 10, fontSize: 16 },
});
