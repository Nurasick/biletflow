import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { DateTimeField } from '@/components/date-time-field';
import { Action, FormField, Info, Panel, WorkspaceScreen, useWorkspaceColors } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { DEFAULT_EVENT_TIME_ZONE, defaultEventInstant, optionalIso, requiredIso } from '@/lib/zoned-time';
import { normalizePayoutProvider, type PayoutProvider } from '@/lib/organizer-filters';
import { managementApi, type ManagedEvent, type OrganizerProfile } from '@/shared/api/management';

const CATEGORIES = ['concert', 'theater', 'sport', 'conference', 'other'];
const VISIBILITIES = ['public', 'unlisted', 'private'];
// SRS 4.16: the organizer dashboard classifies events by phase.
const PHASE_FILTERS = ['all', 'draft', 'upcoming', 'active', 'completed', 'cancelled'] as const;
type PhaseFilter = (typeof PHASE_FILTERS)[number];
const cycle = <T,>(values: readonly T[], current: T): T => values[(values.indexOf(current) + 1) % values.length];

export default function OrganizerScreen() {
  const { authenticatedFetch, user } = useAuth(); const { t, formatDate } = useI18n(); const router = useRouter(); const colors = useWorkspaceColors();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null); const [events, setEvents] = useState<ManagedEvent[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [revision, setRevision] = useState(0);
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [displayName, setDisplayName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [description, setDescription] = useState(''); const [provider, setProvider] = useState<PayoutProvider>('sandbox_bank'); const [payout, setPayout] = useState('demo_account');
  const [title, setTitle] = useState(''); const [venue, setVenue] = useState(''); const [address, setAddress] = useState('');
  const [starts, setStarts] = useState(() => defaultEventInstant(7, 19)); const [ends, setEnds] = useState(() => defaultEventInstant(7, 21));
  const [cover, setCover] = useState(''); const [eventDescription, setEventDescription] = useState(''); const [refundPolicy, setRefundPolicy] = useState('');
  const [category, setCategory] = useState('concert'); const [visibility, setVisibility] = useState('public'); const [seatingMode, setSeatingMode] = useState<'general_admission'|'assigned'>('general_admission');
  const [timeZone,setTimeZone]=useState(DEFAULT_EVENT_TIME_ZONE);
  const [capacity, setCapacity] = useState(''); const [opensAt, setOpensAt] = useState(''); const [closesAt, setClosesAt] = useState('');

  useFocusEffect(useCallback(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void (async () => {
      const found = await managementApi.profileOrNull(authenticatedFetch);
      // Only an organizer has events to list; asking without a profile is a guaranteed 403.
      const list = found ? await managementApi.events(authenticatedFetch, controller.signal) : [];
      if (controller.signal.aborted) return;
      setProfile(found); setEvents(list);
      setDisplayName(found?.display_name ?? ''); setEmail(found?.contact_email ?? user?.email ?? ''); setPhone(found?.contact_phone ?? ''); setDescription(found?.description ?? '');
      setProvider(normalizePayoutProvider(found?.payout_account?.provider)); setPayout(found?.payout_account?.external_account_ref ?? 'demo_account');
    })().catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load organizer workspace.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authenticatedFetch, revision, user?.email]));

  const run = async (task: () => Promise<unknown>, success: string) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await task(); setMessage(success); setRevision(v => v + 1); } catch (failure) { setError(failure instanceof Error ? failure.message : 'The request failed.'); } finally { setBusy(false); } };
  const saveProfile = () => void run(() => managementApi.saveProfile(authenticatedFetch, { display_name: displayName.trim(), contact_email: email.trim(), contact_phone: phone.trim() || null, description: description.trim() || null, payout_provider: payout.trim() ? provider : null, payout_reference: payout.trim() || null }), 'Organizer profile saved.');
  const createEvent = () => void run(async () => {
    const startsAt = requiredIso(starts); const endsAt = requiredIso(ends);
    if (!title.trim() || !venue.trim() || !address.trim() || endsAt <= startsAt) throw new Error('Enter a title, venue, address, and valid event date range.');
    const event = await managementApi.createEvent(authenticatedFetch, { title: title.trim(), description: eventDescription.trim() || null, refund_policy: refundPolicy.trim() || null, category, visibility, seating_mode: seatingMode, venue_name: venue.trim(), venue_address: address.trim(), starts_at: startsAt, ends_at: endsAt, timezone: timeZone.trim() || DEFAULT_EVENT_TIME_ZONE, capacity: capacity.trim() ? Number(capacity) : null, registration_opens_at: optionalIso(opensAt), registration_closes_at: optionalIso(closesAt), cover_image_url: cover.trim() || null });
    setTitle(''); setCover(''); router.push({ pathname: '/organizer-event', params: { eventId: String(event.id) } });
  }, 'Draft event created.');
  const shownEvents = phaseFilter === 'all' ? events : events.filter(event => event.phase === phaseFilter);

  return <WorkspaceScreen title={t('Organizer workspace')} onRefresh={() => setRevision(v => v + 1)} refreshing={loading}>
    {!!error && <Info tone="error">{t(error)}</Info>}{!!message && <Info tone="success">{t(message)}</Info>}
    <Panel><Info>{profile ? t('Organizer profile') : t('Become an organizer')}</Info><Info tone="muted">{profile ? `${profile.display_name} · ${t(profile.verification_status)}${profile.payout_account ? ` · ${t('Payout')}: ${t(profile.payout_account.status)}` : ''}` : t('Create your organizer profile to manage events and ticket sales.')}</Info>
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
    {!!profile && <>
      <Panel><Info>{t('Your events')} · {shownEvents.length}</Info>
        <Action secondary label={`${t('Show')}: ${t(phaseFilter === 'all' ? 'All' : phaseFilter)} · ${t('Change')}`} onPress={() => setPhaseFilter(value => cycle(PHASE_FILTERS, value))} />
        {shownEvents.map(event => <Pressable key={event.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/organizer-event', params: { eventId: String(event.id) } })} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12, gap: 5 }}><Info>{event.title}</Info><Info tone="muted">{formatDate(event.starts_at, event.timezone)} · {event.venue_name} · {t(event.phase)}</Info><Info tone="muted">{t(event.visibility)} · {t(event.status)}</Info></Pressable>)}
        {!shownEvents.length && !loading && <Info tone="muted">{t(events.length ? 'No events in this group.' : 'No events yet. Create a draft below.')}</Info>}
      </Panel>
      <Panel><Info>{t('Create a draft event')}</Info><Info tone="muted">{t('Times are entered in the selected event time zone.')}</Info>
        <FormField label={t('Event title')} value={title} onChangeText={setTitle} maxLength={300} />
        <FormField label={t('Description')} value={eventDescription} onChangeText={setEventDescription} multiline maxLength={10000} />
        <Action secondary label={`${t('Category')}: ${t(category)} · ${t('Change')}`} onPress={() => setCategory(value => cycle(CATEGORIES, value))} />
        <Action secondary label={`${t('Visibility')}: ${t(visibility)} · ${t('Change')}`} onPress={() => setVisibility(value => cycle(VISIBILITIES, value))} />
        <Action secondary label={`${t('Seating')}: ${t(seatingMode === 'assigned' ? 'Assigned seating' : 'General admission')} · ${t('Change')}`} onPress={() => setSeatingMode(value => value === 'assigned' ? 'general_admission' : 'assigned')} />
        <FormField label={t('Venue name')} value={venue} onChangeText={setVenue} />
        <FormField label={t('Venue address')} value={address} onChangeText={setAddress} />
        <FormField label={t('Event timezone (IANA)')} value={timeZone} onChangeText={setTimeZone} autoCapitalize="none" />
        <DateTimeField label={t('Starts at')} value={starts} onChange={setStarts} timeZone={timeZone} />
        <DateTimeField label={t('Ends at')} value={ends} onChange={setEnds} timeZone={timeZone} />
        <FormField label={t('Capacity (optional)')} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
        <DateTimeField optional label={t('Registration opens at')} value={opensAt} onChange={setOpensAt} timeZone={timeZone} />
        <DateTimeField optional label={t('Registration closes at')} value={closesAt} onChange={setClosesAt} timeZone={timeZone} />
        <FormField label={t('Refund policy (optional)')} value={refundPolicy} onChangeText={setRefundPolicy} multiline maxLength={2000} />
        <FormField label={t('Cover image URL (optional)')} value={cover} onChangeText={setCover} autoCapitalize="none" />
        <Action label={t(busy ? 'Creating…' : 'Create draft')} disabled={busy || !title.trim() || !venue.trim() || !address.trim()} onPress={createEvent} />
      </Panel>
      <Info tone="muted">{t('Add photos from the event page after creating the draft.')}</Info>
    </>}
    {!profile && !loading && <Info tone="muted">{t('Save the profile above to start creating events.')}</Info>}
  </WorkspaceScreen>;
}
