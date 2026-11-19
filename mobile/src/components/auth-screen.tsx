import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, TicketArtwork, Wordmark } from '@/components/design';
import { ScreenHeading } from '@/components/workspace';
import { Stage } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSelector } from '@/i18n';

export function AuthScreen({ title, busy, children }: PropsWithChildren<{ title: string; busy?: boolean }>) {
  const colors = useTheme();
  const { width, fontScale } = useWindowDimensions();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            <View style={styles.banner}>
              {width >= 360 && fontScale < 1.4 && <View pointerEvents="none" style={styles.decoration}>
                <View style={styles.ring} />
                <View style={[styles.ring, { margin: 13 }]} />
                <View style={{ transform: [{ scale: 0.66 }] }}><TicketArtwork /></View>
              </View>}
              <Wordmark onStage />
            </View>
            <View style={[styles.panel, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <ScreenHeading>{title}</ScreenHeading>
              {children}
            </View>
            <LanguageSelector disabled={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: disabled || pressed ? 0.6 : 1 }]}>
      <AppText style={{ color: colors.accent, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 17, paddingVertical: 18 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 13 },
  banner: { minHeight: 104, justifyContent: 'center', overflow: 'hidden', borderRadius: 20, padding: 17, backgroundColor: Stage.background },
  decoration: { position: 'absolute', right: -32, top: -12, bottom: -12, justifyContent: 'center' },
  ring: { position: 'absolute', top: -34, right: 5, width: 190, height: 190, borderRadius: 95, borderWidth: 1, borderColor: Stage.lines },
  panel: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 14 },
  link: { alignSelf: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 4, paddingVertical: 3, flexShrink: 1 },
});
