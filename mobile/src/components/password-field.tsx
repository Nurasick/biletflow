import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type TextInputProps } from 'react-native';
import type { Ref } from 'react';

import { AppText, Icon } from '@/components/design';
import { FormInput, type TextInputHandle } from '@/components/workspace';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';

// Browsers add their own reveal button to password inputs; ours replaces it.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('bf-password-reveal')) {
  const style = document.createElement('style');
  style.id = 'bf-password-reveal';
  style.textContent = 'input::-ms-reveal,input::-ms-clear{display:none}';
  document.head.appendChild(style);
}

type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry'> & { label: string; hint?: string; ref?: Ref<TextInputHandle> };

/** A labelled password input with the show/hide eye inside the field. */
export function PasswordField({ label, hint, editable = true, style, ...props }: PasswordFieldProps) {
  const colors = useTheme();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ gap: 7 }}>
      <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{label}</AppText>
      <View style={styles.wrap}>
        <FormInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          editable={editable} {...props} secureTextEntry={!visible} style={[styles.input, style]} />
        <Pressable accessibilityRole="button" accessibilityLabel={t(visible ? 'Hide password' : 'Show password')}
          accessibilityState={{ checked: visible, disabled: !editable }} disabled={!editable} onPress={() => setVisible((value) => !value)}
          style={({ pressed }) => [styles.eye, { opacity: pressed ? 0.55 : 1 }]}>
          <Icon name={visible ? 'eyeSlash' : 'eye'} color={colors.muted} size={21} />
        </Pressable>
      </View>
      {!!hint && <AppText style={{ color: colors.muted, fontSize: 12 }}>{hint}</AppText>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { paddingRight: 52 },
  eye: { position: 'absolute', right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
