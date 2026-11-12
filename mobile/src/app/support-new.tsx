import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Action, FormField, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { caseCategories, supportApi, type CaseCategory, type CaseAudience } from '@/shared/api/support';

function first(value: string | string[] | undefined) {return Array.isArray(value) ? value[0] : value;}

export default function NewSupportScreen() {
  const params = useLocalSearchParams<{eventId?:string;orderNumber?:string;ticketCode?:string;audience?:string}>();
  const router = useRouter();
  const {authenticatedFetch} = useAuth();
  const {t} = useI18n();
  const eventId = first(params.eventId);
  const orderNumber = first(params.orderNumber);
  const ticketCode = first(params.ticketCode);
  const audience: CaseAudience = first(params.audience) === 'organizer' ? 'organizer' : 'attendee';
  const contextKey = JSON.stringify([eventId,orderNumber,ticketCode,audience]);
  const currentKey = useRef(contextKey);
  currentKey.current = contextKey;
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true;return () => {mounted.current=false;};}, []);
  const [category, setCategory] = useState<CaseCategory>('technical');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hasContext = !!(eventId || orderNumber || ticketCode) || audience === 'organizer';

  const submit = async () => {
    if (lock.current) return;
    const key = contextKey;
    lock.current = true; setBusy(true); setError('');
    try {
      const created = await supportApi.create(authenticatedFetch, {
        audience, category, body,
        ...(eventId ? {event_id:Number(eventId)} : {}),
        ...(orderNumber ? {order_number:orderNumber} : {}),
        ...(ticketCode ? {ticket_code:ticketCode} : {}),
      });
      if (mounted.current && currentKey.current === key) {
        setBody('');
        router.replace({pathname:'/support-case',params:{caseNumber:created.case_number,mode:'requester'}});
      }
    } catch (failure) {
      if (mounted.current && currentKey.current === key) setError(failure instanceof Error ? failure.message : 'The support request could not be completed.');
    } finally {
      lock.current = false;
      if (mounted.current && currentKey.current === key) setBusy(false);
    }
  };

  return <WorkspaceScreen title={t('New support request')}>
    <Panel>
      <Info>{t(audience === 'organizer' ? 'To platform support' : 'To the event organizer')}</Info>
      {!!(eventId) && <Info>{t('Event')}: {eventId}</Info>}
      {!!(orderNumber) && <Info>{t('Order')}: {orderNumber}</Info>}
      {!!(ticketCode) && <Info>{t('Ticket')}: {ticketCode}</Info>}
      {!hasContext && <Info tone="error">{t('Open support from an event, order, or ticket to include its context.')}</Info>}
    </Panel>
    <Info>{t('Issue category')}</Info>
    {caseCategories.map(item => <Action key={item.value} label={(category === item.value ? t('Selected')+': ' : '')+t(item.label)} secondary={category !== item.value} disabled={busy} onPress={() => setCategory(item.value)} />)}
    <FormField label={t('Describe the problem')} value={body} onChangeText={setBody} editable={!busy} multiline maxLength={5000} textAlignVertical="top" style={{minHeight:120}} />
    <Info tone="muted">{body.length} / 5000</Info>
    {!!error && <Info tone="error">{t(error)}</Info>}
    <Action label={t(busy ? 'Sending...' : 'Send request')} disabled={busy || !hasContext || !body.trim()} onPress={() => {void submit();}} />
    <Action label={t('My requests')} secondary disabled={busy} onPress={() => router.push('/support')} />
    <Info tone="muted">{t('Do not include passwords or payment-card information.')}</Info>
  </WorkspaceScreen>;
}
