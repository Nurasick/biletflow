import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, TicketArtwork, Wordmark } from '@/components/design';
import { Stage } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSelector } from '@/i18n';

/** Shared frame for sign-in, sign-up, reset and verification: brand, heading, form, language. */
export function AuthScreen({ title, subtitle, busy, children }: PropsWithChildren<{ title: string; subtitle?: string; busy?: boolean }>) {
  const colors = useTheme();
  const { width, fontScale } = useWindowDimensions();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            <View style={styles.banner}>
              {width >= 360 && fontScale < 1.4 && <View pointerEvents="none" style={styles.decoration}>
                <View style={styles.ring} />
                <View style={{ transform: [{ scale: 0.58 }, { rotate: '4deg' }] }}><TicketArtwork /></View>
              </View>}
              <Wordmark onStage />
            </View>
            <View style={styles.heading}>
              <AppText accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</AppText>
              {!!subtitle && <AppText style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>{subtitle}</AppText>}
            </View>
            <View style={styles.form}>{children}</View>
            <View style={styles.footer}><LanguageSelector disabled={busy} /></View>
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
      <AppText style={{ color: colors.accent, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{label}</AppText>
    </Pressable>
  );
}

/** "Question? Action" on one line, wrapping cleanly in longer languages. */
export function AuthPrompt({ question, action, onPress, disabled }: { question: string; action: string; onPress: () => void; disabled?: boolean }) {
  const colors = useTheme();
  return (
    <View style={styles.prompt}>
      <AppText style={{ color: colors.muted, fontSize: 15 }}>{question}</AppText>
      <AuthLink label={action} onPress={onPress} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  content: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  banner: { height: 88, justifyContent: 'center', overflow: 'hidden', borderRadius: 22, paddingHorizontal: 18, backgroundColor: Stage.background },
  decoration: { position: 'absolute', right: -36, top: -16, bottom: -16, justifyContent: 'center' },
  ring: { position: 'absolute', top: -30, right: 0, width: 170, height: 170, borderRadius: 85, borderWidth: 1, borderColor: Stage.lines },
  heading: { marginTop: 28, marginBottom: 20, gap: 6 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1.2 },
  form: { gap: 16 },
  footer: { marginTop: 'auto', paddingTop: 28 },
  link: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 4, flexShrink: 1 },
  prompt: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 4 },
});
