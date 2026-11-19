import { useState } from 'react';

import { decode } from '@/api/public';
import { AuthLink, AuthScreen } from '@/components/auth-screen';
import { Action, FormField, Info } from '@/components/workspace';
import { API_V1_URL } from '@/constants/api';
import { useI18n } from '@/i18n';

export function RegisterForm({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

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

  return (
    <AuthScreen title={t('Create account')} busy={busy}>
      {done ? (
        <>
          <Info tone="success">{t('Account created. Sign in with your new credentials.')}</Info>
          <Action label={t('Back to sign in')} onPress={onBack} />
        </>
      ) : (
        <>
          <FormField label={t('First name')} value={first} onChangeText={setFirst} autoComplete="given-name" maxLength={100} editable={!busy} />
          <FormField label={t('Last name')} value={last} onChangeText={setLast} autoComplete="family-name" maxLength={100} editable={!busy} />
          <FormField label={t('Email')} value={email} onChangeText={setEmail} autoComplete="email" autoCapitalize="none" keyboardType="email-address" maxLength={254} editable={!busy} />
          <FormField label={t('Password')} value={password} onChangeText={setPassword} autoComplete="new-password" maxLength={50} editable={!busy} secureTextEntry />
          {error !== '' && <Info tone="error">{t(error)}</Info>}
          <Action label={t(busy ? 'Creating account...' : 'Create account')} disabled={busy} onPress={() => void submit()} />
          <AuthLink label={t('Back to sign in')} disabled={busy} onPress={onBack} />
        </>
      )}
    </AuthScreen>
  );
}
