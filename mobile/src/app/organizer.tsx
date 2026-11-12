import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Action, FormField, Info, Panel, WorkspaceScreen, useWorkspaceColors } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { managementApi, type ManagedEvent, type OrganizerProfile } from '@/shared/api/management';

const nextDate = (days: number, hour: number) => { const date = new Date(Date.now() + days * 86400000); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function OrganizerScreen() {
  const { authenticatedFetch } = useAuth(); const { t } = useI18n(); const router = useRouter(); const colors = useWorkspaceColors();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null); const [events, setEvents] = useState<ManagedEvent[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [revision, setRevision] = useState(0);
  const [displayName, setDisplayName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [description, setDescription] = useState(''); const [provider, setProvider] = useState('sandbox_bank'); const [payout, setPayout] = useState('demo_account');
  const [title, setTitle] = useState(''); const [venue, setVenue] = useState(''); const [address, setAddress] = useState(''); const [starts, setStarts] = useState(nextDate(7, 19)); const [ends, setEnds] = useState(nextDate(7, 21)); const [cover, setCover] = useState(''); const [eventDescription,setEventDescription]=useState(''); const [refundPolicy,setRefundPolicy]=useState(''); const [category,setCategory]=useState('concert'); const [visibility,setVisibility]=useState('public'); const [seatingMode,setSeatingMode]=useState<'general_admission'|'assigned'>('general_admission'); const [capacity,setCapacity]=useState(''); const [opensAt,setOpensAt]=useState(''); const [closesAt,setClosesAt]=useState('');
  useFocusEffect(useCallback(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void Promise.all([managementApi.profile(authenticatedFetch), managementApi.events(authenticatedFetch, controller.signal).catch(() => [])]).then(([p, list]) => {
      if (!controller.signal.aborted) { setProfile(p); setEvents(list); setDisplayName(p.display_name); setEmail(p.contact_email); setPhone(p.contact_phone ?? ''); setDescription(p.description ?? ''); setProvider(p.payout_account?.provider ?? 'sandbox_bank'); setPayout(p.payout_account?.external_account_ref ?? 'demo_account'); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load organizer workspace.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authenticatedFetch, revision]));
  const run = async (task: () => Promise<unknown>, success: string) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await task(); setMessage(success); setRevision(v => v + 1); } catch (failure) { setError(failure instanceof Error ? failure.message : 'The request failed.'); } finally { setBusy(false); } };
  const saveProfile = () => void run(() => managementApi.saveProfile(authenticatedFetch, { display_name: displayName.trim(), contact_email: email.trim(), contact_phone: phone.trim() || null, description: description.trim() || null, payout_provider: payout.trim() ? provider : null, payout_reference: payout.trim() || null }), 'Organizer profile saved.');
  const createEvent = () => void run(async () => {
    const start = new Date(starts); const end = new Date(ends); if (!title.trim() || !venue.trim() || !address.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Enter a title, venue, address, and valid event date range.');
    const event = await managementApi.createEvent(authenticatedFetch, { title: title.trim(), description:eventDescription.trim()||null, refund_policy:refundPolicy.trim()||null, category, visibility, seating_mode:seatingMode, venue_name: venue.trim(), venue_address: address.trim(), starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: 'Asia/Almaty', capacity:capacity.trim()?Number(capacity):null, registration_opens_at:opensAt.trim()?new Date(opensAt).toISOString():null, registration_closes_at:closesAt.trim()?new Date(closesAt).toISOString():null, cover_image_url: cover.trim() || null });
    setTitle(''); setCover(''); router.push({ pathname: '/organizer-event', params: { eventId: String(event.id) } });
  }, 'Draft event created.');
  const onRefresh = () => setRevision(v => v + 1);
  return <WorkspaceScreen title={t('Organizer workspace')} onRefresh={onRefresh} refreshing={loading}>
    {!!error && <Info tone="error">{t(error)}</Info>}{!!message && <Info tone="success">{t(message)}</Info>}
    <Panel><Info>{profile ? t('Organizer profile') : t('Become an organizer')}</Info><Info tone="muted">{profile ? `${profile.display_name} · ${t(profile.verification_status)}${profile.payout_account ? ` · ${t('Payout')}: ${profile.payout_account.status}` : ''}` : t('Create your organizer profile to manage events and ticket sales.')}</Info>
      <FormField label={t('Organization name')} value={displayName} onChangeText={setDisplayName} maxLength={200} />
      <FormField label={t('Contact email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <FormField label={t('Contact phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <FormField label={t('Description')} value={description} onChangeText={setDescription} multiline />
      <Info tone="muted">{t('Sandbox payout account; use a demo reference only. No real bank details or money are used.')}</Info>
      <Action secondary label={`${t('Payout provider')}: ${provider === 'sandbox_bank' ? t('Sandbox bank') : t('Sandbox wallet')} · ${t('Change')}`} onPress={() => setProvider(value => value === 'sandbox_bank' ? 'sandbox_wallet' : 'sandbox_bank')} />
      <FormField label={t('Demo payout reference (demo_...)')} value={payout} onChangeText={setPayout} autoCapitalize="none" />
      <Action label={t(busy ? 'Saving…' : 'Save organizer profile')} disabled={busy || !displayName.trim() || !email.trim()} onPress={saveProfile} />
      {!!profile && profile.verification_status !== 'verified' && <Action secondary label={t('Run simulated identity verification')} disabled={busy} onPress={() => void run(() => managementApi.verifyProfile(authenticatedFetch), 'Simulated verification completed.')} />}
    </Panel>
    <Panel><Info>{t('Your events')} · {events.length}</Info>{events.map(event => <Pressable key={event.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/organizer-event', params: { eventId: String(event.id) } })} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12, gap: 5 }}><Info>{event.title}</Info><Info tone="muted">{shortDate(event.starts_at)} · {event.venue_name} · {t(event.phase)}</Info><Info tone="muted">{t(event.visibility)} · {t(event.status)}</Info></Pressable>)}{!events.length && !loading && <Info tone="muted">{t('No events yet. Create a draft below.')}</Info>}</Panel>
    <Panel><Info>{t('Create a draft event')}</Info><Info tone="muted">{t('Event times use Asia/Almaty. Enter ISO date and time, for example 2026-12-01T19:00:00+05:00.')}</Info>
      <FormField label={t('Event title')} value={title} onChangeText={setTitle} maxLength={300} />
      <FormField label={t('Description')} value={eventDescription} onChangeText={setEventDescription} multiline maxLength={10000} />
      <Action secondary label={`${t('Category')}: ${t(category)} · ${t('Change')}`} onPress={()=>setCategory(value=>{const values=['concert','theater','sport','conference','other'];return values[(values.indexOf(value)+1)%values.length];})} />
      <Action secondary label={`${t('Visibility')}: ${t(visibility)} · ${t('Change')}`} onPress={()=>setVisibility(value=>{const values=['public','unlisted','private'];return values[(values.indexOf(value)+1)%values.length];})} />
      <Action secondary label={`${t('Seating')}: ${t(seatingMode==='assigned'?'Assigned seating':'General admission')} · ${t('Change')}`} onPress={()=>setSeatingMode(value=>value==='assigned'?'general_admission':'assigned')} />
      <FormField label={t('Venue name')} value={venue} onChangeText={setVenue} />
      <FormField label={t('Venue address')} value={address} onChangeText={setAddress} />
      <FormField label={t('Starts at (ISO 8601)')} value={starts} onChangeText={setStarts} autoCapitalize="none" />
      <FormField label={t('Ends at (ISO 8601)')} value={ends} onChangeText={setEnds} autoCapitalize="none" />
      <FormField label={t('Capacity (optional)')} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
      <FormField label={t('Registration opens at (ISO 8601, optional)')} value={opensAt} onChangeText={setOpensAt} autoCapitalize="none" />
      <FormField label={t('Registration closes at (ISO 8601, optional)')} value={closesAt} onChangeText={setClosesAt} autoCapitalize="none" />
      <FormField label={t('Refund policy (optional)')} value={refundPolicy} onChangeText={setRefundPolicy} multiline maxLength={2000} />
      <FormField label={t('Cover image URL (optional)')} value={cover} onChangeText={setCover} autoCapitalize="none" />
      <Action label={t(busy ? 'Creating…' : 'Create draft')} disabled={busy || !title.trim() || !venue.trim() || !address.trim()} onPress={createEvent} />
    </Panel>
    <Info tone="muted">{t('Event images can be shown from a public URL. Seat selection remains a preview until the backend supports seat holds.')}</Info>
  </WorkspaceScreen>;
}
