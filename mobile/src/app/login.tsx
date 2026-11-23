import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthLink, AuthPrompt, AuthScreen } from '@/components/auth-screen';
import { AppText, Icon } from '@/components/design';
import { PasswordField } from '@/components/password-field';
import { RegisterForm } from '@/components/register-form';
import { Action, FormField, Info, type TextInputHandle } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import { requestPasswordReset } from '@/shared/api/auth';

export default function LoginScreen() {
  const { t } = useI18n();
  const colors = useTheme();
  const router = useRouter();
  const { login, loading, error } = useAuth();
  const passwordRef = useRef<TextInputHandle>(null);
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const emailField = (onSubmit: () => void) => (
    <FormField label={t('Email address')} autoCapitalize="none" autoComplete="email" textContentType="username" keyboardType="email-address"
      autoCorrect={false} editable={!(resetMode ? resetBusy : loading)} placeholder="you@example.com" value={email} onChangeText={changeEmail}
      returnKeyType={resetMode ? 'send' : 'next'} submitBehavior={resetMode ? 'blurAndSubmit' : 'submit'} onSubmitEditing={onSubmit} />
  );

  if (registering) return <RegisterForm onBack={() => setRegistering(false)} />;
  if (resetMode) {
    return (
      <AuthScreen title={t('Reset password')} subtitle={t('Enter your account email and we will send a password reset link if the account exists.')} busy={resetBusy}>
        {emailField(() => void handlePasswordReset())}
        {resetError && <Info tone="error">{t(resetError)}</Info>}
        {resetMessage && <Info tone="success">{t(resetMessage)}</Info>}
        <Action label={t(resetBusy ? 'Sending...' : 'Send reset link')} disabled={resetBusy} onPress={() => void handlePasswordReset()} />
        <View style={styles.stack}>
          <AuthLink label={t('I have a reset token')} disabled={resetBusy} onPress={() => router.push('/reset-password')} />
          <AuthLink label={t('Back to sign in')} disabled={resetBusy} onPress={() => setResetMode(false)} />
        </View>
      </AuthScreen>
    );
  }

  const displayedError = formError ?? error;
  return (
    <AuthScreen title={t('Sign in')} subtitle={t('Sign in to access your tickets and orders.')} busy={loading}>
      {emailField(() => passwordRef.current?.focus())}
      <PasswordField ref={passwordRef} label={t('Password')} autoComplete="current-password" textContentType="password" editable={!loading}
        value={password} onChangeText={(value) => { setPassword(value); setFormError(null); }}
        returnKeyType="go" onSubmitEditing={() => void handleLogin()} />
      <View style={styles.options}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rememberMe, disabled: loading }} disabled={loading}
          onPress={() => setRememberMe((value) => !value)} style={({ pressed }) => [styles.remember, { opacity: pressed ? 0.72 : 1 }]}>
          <View style={[styles.checkbox, { borderColor: rememberMe ? colors.button : colors.border, backgroundColor: rememberMe ? colors.button : colors.surface }]}>
            {rememberMe && <Icon name="check" color="#FFFFFF" size={14} />}
          </View>
          <AppText style={{ color: colors.text, fontSize: 15 }}>{t('Remember me')}</AppText>
        </Pressable>
        <AuthLink label={t('Forgot password?')} disabled={loading}
          onPress={() => { setResetMode(true); setResetError(null); setResetMessage(null); }} />
      </View>
      {displayedError && <View style={[styles.error, { backgroundColor: colors.dangerWash }]}><Info tone="error">{t(displayedError)}</Info></View>}
      <Action label={t(loading ? 'Signing in...' : 'Sign in')} disabled={loading} onPress={() => void handleLogin()} />

      <View style={[styles.divider, { borderTopColor: colors.border }]}>
        <AppText style={{ color: colors.muted, fontSize: 15, textAlign: 'center' }}>{t('New to BiletFlow?')}</AppText>
        <Action secondary label={t('Create account')} disabled={loading} onPress={() => setRegistering(true)} />
        <AuthPrompt question={t('Got a verification email?')} action={t('Verify email')} disabled={loading} onPress={() => router.push('/verify-email')} />
      </View>
      <AppText style={{ color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>
        {t('By signing in, you agree to our Terms of Service and Privacy Policy.')}
      </AppText>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: -6 },
  remember: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  error: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, paddingTop: 20, gap: 12 },
  stack: { alignItems: 'center', gap: 2 },
});
