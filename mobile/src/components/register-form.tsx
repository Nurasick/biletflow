import { useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { decode } from '@/api/public';
import { AuthPrompt, AuthScreen } from '@/components/auth-screen';
import { PasswordField } from '@/components/password-field';
import { Action, FormField, Info, type TextInputHandle } from '@/components/workspace';
import { API_V1_URL } from '@/constants/api';
import { useI18n } from '@/i18n';

export function RegisterForm({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const { width, fontScale } = useWindowDimensions();
  const lastRef = useRef<TextInputHandle>(null);
  const emailRef = useRef<TextInputHandle>(null);
  const passwordRef = useRef<TextInputHandle>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const namesSideBySide = width >= 360 && fontScale < 1.3;

  const submit = async () => {
    if (busy) return;
    if (!first.trim() || !last.trim() || !email.trim() || password.length < 8 || password.length > 50) {
      setError('Enter your name, email, and a password of 8-50 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await decode(await fetch(`${API_V1_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: first.trim(), last_name: last.trim(), email: email.trim().toLowerCase(), password, locale }),
      }));
      setPassword('');
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthScreen title={t('Check your email')} subtitle={t('Account created. Sign in with your new credentials.')}>
        <Action label={t('Back to sign in')} onPress={onBack} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('Create account')} subtitle={t('Get tickets, keep them in one place, and check in with a QR code.')} busy={busy}>
      <View style={{ flexDirection: namesSideBySide ? 'row' : 'column', gap: namesSideBySide ? 10 : 16 }}>
        <View style={{ flex: namesSideBySide ? 1 : undefined }}>
          <FormField label={t('First name')} value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" maxLength={100}
            editable={!busy} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => lastRef.current?.focus()} />
        </View>
        <View style={{ flex: namesSideBySide ? 1 : undefined }}>
          <FormField ref={lastRef} label={t('Last name')} value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" maxLength={100}
            editable={!busy} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => emailRef.current?.focus()} />
        </View>
      </View>
      <FormField ref={emailRef} label={t('Email')} value={email} onChangeText={setEmail} autoComplete="email" textContentType="emailAddress" autoCapitalize="none"
        autoCorrect={false} keyboardType="email-address" maxLength={254} editable={!busy} returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()} />
      <PasswordField ref={passwordRef} label={t('Password')} hint={t('Use 8–50 characters.')} value={password} onChangeText={setPassword}
        autoComplete="new-password" textContentType="newPassword" maxLength={50} editable={!busy} returnKeyType="go" onSubmitEditing={() => void submit()} />
      {error !== '' && <Info tone="error">{t(error)}</Info>}
      <Action label={t(busy ? 'Creating account...' : 'Create account')} disabled={busy} onPress={() => void submit()} />
      <AuthPrompt question={t('Already have an account?')} action={t('Sign in')} disabled={busy} onPress={onBack} />
    </AuthScreen>
  );
}
