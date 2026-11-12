import { useState } from 'react';
import { TextInput } from 'react-native';
import { API_V1_URL } from '@/constants/api';
import { decode } from '@/api/public';
import { Screen, Label, Button } from '@/components/api-screen';
import { LanguageSelector, useI18n } from '@/i18n';
export function RegisterForm({ onBack }: {
    onBack: () => void;
}) {
    const { t, locale } = useI18n();
    const [first, setFirst] = useState('');
    const [last, setLast] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const submit = async () => { if (busy)
        return; if (!first.trim() || !last.trim() || !email.trim() || password.length < 8 || password.length > 50) {
        setError('Enter your name, email, and a password of 8-50 characters.');
        return;
    } setBusy(true); setError(''); try {
        await decode(await fetch(`${API_V1_URL}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first_name: first.trim(), last_name: last.trim(), email: email.trim().toLowerCase(), password, locale }) }));
        setPassword('');
        setDone(true);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Registration failed.');
    }
    finally {
        setBusy(false);
    } };
    return <Screen title={t('Create account')} onBack={() => { if (!busy)
        onBack(); }}>
        <Label>{t('Account language')}</Label>
        <LanguageSelector disabled={busy} />
        {done ? <>
            <Label>{t('Account created. Sign in with your new credentials.')}</Label>
            <Button title={t('Back to sign in')} onPress={onBack}/>
        </> : <>
            {!!error && <Label>{t(error)}</Label>}
            {[
                { label: 'First name', value: first, set: setFirst, max: 100 },
                { label: 'Last name', value: last, set: setLast, max: 100 },
                { label: 'Email', value: email, set: setEmail, max: 254 },
                { label: 'Password', value: password, set: setPassword, max: 50 },
            ].map(f => <TextInput key={f.label} accessibilityLabel={t(f.label)} placeholder={t(f.label)} placeholderTextColor="#98A2B3" className="rounded border border-gray-500 p-3 text-white" value={f.value} onChangeText={f.set} maxLength={f.max} secureTextEntry={f.label === 'Password'} autoCapitalize="none" keyboardType={f.label === 'Email' ? 'email-address' : 'default'} editable={!busy}/>)}
            <Button title={t(busy ? 'Creating account...' : 'Create account')} disabled={busy} onPress={() => void submit()}/>
            <Button title={t('Back to sign in')} disabled={busy} onPress={onBack}/>
        </>}
    </Screen>;
}
