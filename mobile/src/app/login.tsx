import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthLink, AuthScreen } from '@/components/auth-screen';
import { AppText, Icon } from '@/components/design';
import { RegisterForm } from '@/components/register-form';
import { Action, FormField, FormInput, Info } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import { requestPasswordReset } from '@/shared/api/auth';

export default function LoginScreen() {
  const { t } = useI18n();
  const colors = useTheme();
  const router = useRouter();
  const { login, loading, error } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (loading) return;
    if (!email.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }
    setFormError(null);
    const signedIn = await login(email, password, rememberMe);
    if (signedIn) router.replace('/');
  };

  const handlePasswordReset = async () => {
    if (resetBusy) return;
    if (!email.trim()) {
      setResetError('Enter your email address first.');
      setResetMessage(null);
      return;
    }
    setResetBusy(true);
    setResetError(null);
    setResetMessage(null);
    try {
      await requestPasswordReset(email);
      setResetMessage('If an account uses this email, a password reset link is on its way.');
    } catch (failure) {
      setResetError(failure instanceof Error ? failure.message : 'Could not request a password reset.');
    } finally {
      setResetBusy(false);
    }
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    setFormError(null);
    setResetError(null);
    setResetMessage(null);
  };
  const emailField = (
    <FormField label={t('Email address')} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
      editable={!(resetMode ? resetBusy : loading)} placeholder="you@example.com" value={email} onChangeText={changeEmail} />
  );

  if (registering) return <RegisterForm onBack={() => setRegistering(false)} />;
  if (resetMode) {
    return (
      <AuthScreen title={t('Reset password')} busy={resetBusy}>
        <Info tone="muted">{t('Enter your account email and we will send a password reset link if the account exists.')}</Info>
        {emailField}
        {resetError && <Info tone="error">{t(resetError)}</Info>}
        {resetMessage && <Info tone="success">{t(resetMessage)}</Info>}
        <Action label={t(resetBusy ? 'Sending...' : 'Send reset link')} disabled={resetBusy} onPress={() => void handlePasswordReset()} />
        <View style={styles.links}>
          <AuthLink label={t('Back to sign in')} disabled={resetBusy} onPress={() => setResetMode(false)} />
          <AuthLink label={t('I have a reset token')} disabled={resetBusy} onPress={() => router.push('/reset-password')} />
        </View>
      </AuthScreen>
    );
  }

  const displayedError = formError ?? error;
  return (
    <AuthScreen title={t('Sign in')} busy={loading}>
      <Info tone="muted">{t('Sign in to access your tickets and orders.')}</Info>
      {emailField}
      <View style={{ gap: 3 }}>
        <View style={styles.fieldHeader}>
          <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{t('Password')}</AppText>
          <AuthLink label={t(showPassword ? 'Hide' : 'Show')} disabled={loading} onPress={() => setShowPassword((previous) => !previous)} />
        </View>
        <FormInput accessibilityLabel={t('Password')} autoComplete="current-password" autoCapitalize="none" editable={!loading}
          secureTextEntry={!showPassword} value={password} onChangeText={(value) => { setPassword(value); setFormError(null); }}
          returnKeyType="go" onSubmitEditing={() => void handleLogin()} />
      </View>
      <View style={styles.options}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rememberMe, disabled: loading }} disabled={loading} onPress={() => setRememberMe((value) => !value)}
          style={({ pressed }) => [styles.remember, { opacity: pressed ? 0.72 : 1 }]}>
          <View style={[styles.checkbox, { borderColor: rememberMe ? colors.button : colors.border, backgroundColor: rememberMe ? colors.button : colors.surface }]}>
            {rememberMe && <Icon name="check" color="#FFFFFF" size={15} />}
          </View>
          <AppText style={{ color: colors.text, fontSize: 13 }}>{t('Remember me')}</AppText>
        </Pressable>
        <AuthLink label={t('Forgot password?')} disabled={loading}
          onPress={() => { setResetMode(true); setResetError(null); setResetMessage(null); }} />
      </View>
      {displayedError && <View style={[styles.error, { backgroundColor: colors.dangerWash }]}><Info tone="error">{t(displayedError)}</Info></View>}
      <Action icon="arrowRight" label={t(loading ? 'Signing in...' : 'Sign in')} disabled={loading} onPress={() => void handleLogin()} />
      <AppText style={{ color: colors.muted, fontSize: 11, lineHeight: 16 }}>{t('By signing in, you agree to our Terms of Service and Privacy Policy.')}</AppText>
      <View style={[styles.secondary, { borderTopColor: colors.border }]}>
        <View style={styles.links}>
          <AppText style={{ color: colors.muted, fontSize: 13 }}>{t("Don't have an account?")}</AppText>
          <AuthLink label={t('Sign up')} disabled={loading} onPress={() => setRegistering(true)} />
        </View>
        <AuthLink label={t('Verify email')} disabled={loading} onPress={() => router.push('/verify-email')} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginVertical: -6 },
  options: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 3, marginVertical: -3 },
  remember: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondary: { borderTopWidth: 1, paddingTop: 4, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 7 },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 5 },
  error: { padding: 10, borderRadius: 10 },
});
