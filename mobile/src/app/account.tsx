import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Action, FormField, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { accountApi, type Account } from '@/shared/api/account';

export default function AccountScreen() {
  const { authenticatedFetch } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void accountApi.get(authenticatedFetch, controller.signal).then(result => {
      if (!controller.signal.aborted) { setAccount(result); setFirst(result.first_name); setLast(result.last_name); setPhone(result.phone ?? ''); setError(''); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The account request failed. Please try again.'); });
    return () => controller.abort();
  }, [authenticatedFetch, revision]));
  const perform = async (save: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (save) { setAccount(await accountApi.update(authenticatedFetch, first, last, phone, locale)); setMessage('Account saved.'); }
      else { await accountApi.resendVerification(authenticatedFetch); setMessage('Check your email for a verification link.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The account request failed. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <WorkspaceScreen title={t('Account')}>
    {!!(error) && <Info tone="error">{t(error)}</Info>}
    {!!(message) && <Info tone="success">{t(message)}</Info>}
    {!account ? <Action label={t('Retry')} onPress={() => setRevision(value => value + 1)} /> : <>
      <Panel>
        <Info>{account.email}</Info>
        <Info>{t(account.is_email_verified ? 'Email verified' : 'Email not verified')}</Info>
        {!account.is_email_verified && <Action label={t('Send verification email')} disabled={busy} onPress={() => void perform(false)} />}
        {!account.is_email_verified && <Action secondary label={t('Enter verification token')} onPress={() => router.push('/verify-email')} />}
      </Panel>
      <FormField label={t('First name')} value={first} onChangeText={setFirst} maxLength={100} editable={!busy} />
      <FormField label={t('Last name')} value={last} onChangeText={setLast} maxLength={100} editable={!busy} />
      <FormField label={t('Phone')} value={phone} onChangeText={setPhone} maxLength={32} keyboardType="phone-pad" editable={!busy} />
      <Action label={t(busy ? 'Saving…' : 'Save account')} disabled={busy || !first.trim() || !last.trim()} onPress={() => void perform(true)} />
    </>}
  </WorkspaceScreen>;
}
