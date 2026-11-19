import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View,
  type TextInputProps,
} from 'react-native';

import { AppText, Icon, type IconName } from '@/components/design';
import { ScreenFrame, type PrimaryTab } from '@/components/screen-frame';
import { Fonts, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const useWorkspaceColors = useTheme;

export function WorkspaceScreen({ title, children, onRefresh, refreshing = false, onBack, tab }: PropsWithChildren<{
  title: string; onRefresh?: () => void; refreshing?: boolean; onBack?: () => void; tab?: PrimaryTab;
}>) {
  const colors = useTheme();
  return (
    <ScreenFrame onBack={onBack} tab={tab}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.button]} /> : undefined}>
        <ScreenHeading>{title}</ScreenHeading>
        {children}
      </ScrollView>
    </ScreenFrame>
  );
}

export function ScreenHeading({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <AppText accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{children}</AppText>;
}

export function Panel({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>;
}

export function Info({ children, tone }: PropsWithChildren<{ tone?: 'muted' | 'error' | 'success' }>) {
  const colors = useTheme();
  return <AppText accessibilityRole={tone === 'error' ? 'alert' : undefined}
    accessibilityLiveRegion={tone === 'error' || tone === 'success' ? 'polite' : 'none'}
    style={{ fontSize: 15, lineHeight: 23, color: tone === 'error' ? colors.danger : tone === 'success' ? colors.success : tone === 'muted' ? colors.muted : colors.text }}>
    {children}
  </AppText>;
}

export function Action({ label, onPress, disabled = false, secondary = false, danger = false, icon }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; icon?: IconName;
}) {
  const colors = useTheme();
  const foreground = danger ? colors.danger : secondary ? colors.accent : '#FFFFFF';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, {
        borderColor: danger ? colors.danger : secondary ? colors.border : colors.button,
        backgroundColor: danger ? colors.dangerWash : secondary ? colors.surface : colors.button,
        opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
      }]}>
      {icon && <Icon name={icon} color={foreground} size={18} />}
      <AppText style={{ flexShrink: 1, color: foreground, textAlign: 'center', fontSize: 15, fontWeight: '700' }}>{label}</AppText>
    </Pressable>
  );
}

export function FormInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const colors = useTheme();
  const [focused, setFocused] = useState(false);
  return <TextInput
    placeholderTextColor={colors.muted}
    selectionColor={colors.accent}
    onFocus={(event) => { setFocused(true); onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); onBlur?.(event); }}
    style={[styles.input, {
      borderColor: focused ? colors.accent : colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
      ...(props.multiline && { minHeight: 96, textAlignVertical: 'top' }),
    }, style]}
    {...props}
  />;
}

export function FormField({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{label}</AppText>
      <FormInput accessibilityLabel={label} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 33, lineHeight: 39, fontWeight: '800', letterSpacing: -1.55 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 32, gap: 16 },
  panel: { padding: 17, borderRadius: 18, borderWidth: 1, gap: 12 },
  action: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 11, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 52, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderRadius: 12, fontSize: 16, fontFamily: Fonts.sans },
});
