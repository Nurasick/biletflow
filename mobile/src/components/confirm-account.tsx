import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Action, FormField, Info, WorkspaceScreen } from '@/components/workspace';
import { useI18n } from '@/i18n';
import { accountApi } from '@/shared/api/account';

export function ConfirmAccount({ reset = false }: { reset?: boolean }) {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const [token, setToken] = useState(Array.isArray(params.token) ? params.token[0] : params.token ?? '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const { t } = useI18n();
  const router = useRouter();
  const submit = async () => {
    if (lock.current) return;
    setError('');
    if (reset && password !== repeat) { setError('Passwords do not match.'); return; }
    lock.current = true; setBusy(true);
    try {
      if (reset) await accountApi.reset(token, password); else await accountApi.verify(token);
      setPassword(''); setRepeat(''); setToken(''); setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The account request failed. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <WorkspaceScreen title={t(reset ? 'Reset password' : 'Verify email')}>
    {!!(error) && <Info tone="error">{t(error)}</Info>}
    {done ? <>
      <Info tone="success">{t(reset ? 'Password updated. Sign in with your new password.' : 'Email verified successfully.')}</Info>
      <Action label={t('Continue')} onPress={() => router.replace('/')} />
    </> : <>
      <Info>{t('Paste the token from your email link. The token is not saved on this device.')}</Info>
      <FormField label={t('Email token')} value={token} onChangeText={setToken} maxLength={200} autoCapitalize="none" secureTextEntry editable={!busy} />
      {!!(reset) && <>
        <FormField label={t('New password')} value={password} onChangeText={setPassword} maxLength={50} secureTextEntry autoCapitalize="none" editable={!busy} />
        <FormField label={t('Repeat password')} value={repeat} onChangeText={setRepeat} maxLength={50} secureTextEntry autoCapitalize="none" editable={!busy} />
      </>}
      <Action label={t(busy ? 'Working…' : 'Confirm')} disabled={busy || !token.trim()} onPress={() => void submit()} />
    </>}
  </WorkspaceScreen>;
}
