import { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Action, FormField, Info, Panel, useWorkspaceColors, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { createScanSession } from '@/lib/scan-session';
import { staffApi, StaffApiError, type Attendance, type ScanOutcome, type ScanResult, type StaffEvent, type StaffTicket } from '@/shared/api/staff';

const outcomeLabels: Record<ScanOutcome, string> = {
  valid: 'Check-in confirmed', invalid: 'Invalid ticket', wrong_event: 'Wrong event',
  cancelled: 'Ticket cancelled', refunded: 'Ticket refunded', already_used: 'Already checked in',
};

export default function StaffEventScreen() {
  const { eventId: rawId } = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
  return <StaffEventWorkspace key={String(eventId)} eventId={eventId} />;
}

function StaffEventWorkspace({ eventId }: { eventId: number }) {
  const router = useRouter();
  const { authenticatedFetch } = useAuth();
  const { t, formatDate } = useI18n();
  const colors = useWorkspaceColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [event, setEvent] = useState<StaffEvent | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [focused, setFocused] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [tickets, setTickets] = useState<StaffTicket[]>([]);
  const [confirmReverse, setConfirmReverse] = useState<StaffTicket | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const gate = useRef(createScanSession());
  const refreshData = useRef<() => Promise<void>>(async () => {});
  const searchVersion = useRef(0);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    gate.current = createScanSession();
    setFocused(true);
    setReady(true);
    setWorking(false);
    setEvent(null);
    setAttendance(null);
    setOnline(false);
    setAccessDenied(false);
    setScanResult(null);
    setActionError('');
    setActionMessage('');
    setConfirmReverse(null);
    setCameraEnabled(false);
    setTickets([]);
    setSearching(false);
    setSearchError('');
    setLastSync(null);
    setSearched(false);
    let pending = false;
    let refreshAfterPending = false;
    const load = async () => {
      if (controller.signal.aborted || AppState.currentState === 'background') return;
      if (pending) { refreshAfterPending = true; return; }
      pending = true;
      setSyncing(true);
      try {
        if (!Number.isSafeInteger(eventId) || eventId < 1) throw new StaffApiError('Choose an assigned event first.', 403);
        const [events, counts] = await Promise.all([
          staffApi.events(authenticatedFetch, controller.signal),
          staffApi.attendance(authenticatedFetch, eventId, controller.signal),
        ]);
        const assigned = events.find(item => item.id === eventId);
        if (!assigned) throw new StaffApiError('Your access to this event is unavailable.', 403);
        if (!controller.signal.aborted) {
          setEvent(assigned);
          setAttendance(counts);
          setOnline(true);
          setAccessDenied(false);
          setSyncError('');
          setLastSync(new Date().toISOString());
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setOnline(false);
          setSyncError(failure instanceof Error ? failure.message : 'Attendance could not be refreshed.');
          if (failure instanceof StaffApiError && failure.status !== null && [401, 403, 404].includes(failure.status)) {
            setAccessDenied(true);
            setEvent(null);
            setTickets([]);
            setAttendance(null);
            setCameraEnabled(false);
          }
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setSyncing(false);
        if (refreshAfterPending && !controller.signal.aborted) { refreshAfterPending = false; void load(); }
      }
    };
    refreshData.current = load;
    void load();
    const poll = setInterval(() => void load(), 15_000);
    const listener = AppState.addEventListener('change', state => {
      const active = state === 'active';
      setForeground(active);
      if (active) void load();
      else { setCameraEnabled(false); setOnline(false); }
    });
    return () => {
      controller.abort();
      clearInterval(poll);
      listener.remove();
      setFocused(false);
      refreshData.current = async () => {};
    };
  }, [authenticatedFetch, eventId]));

  const loadSearch = async () => {
    const term = query.trim();
    if (term.length < 2 || term.length > 100) { setSearchError('Enter between 2 and 100 characters.'); return; }
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchError('');
    try {
      const results = await staffApi.search(authenticatedFetch, eventId, term, controller.signal);
      if (!controller.signal.aborted && version === searchVersion.current) {
        setTickets(results);
        setSearched(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted && version === searchVersion.current) {
        setTickets([]);
        setSearchError(failure instanceof Error ? failure.message : 'Request failed. Check your connection.');
      }
    } finally {
      if (!controller.signal.aborted && version === searchVersion.current) setSearching(false);
    }
  };

  const canVerify = focused && foreground && online && !accessDenied && event?.status === 'published';
  const perform = async (kind: 'scan' | 'manual' | 'reverse', value: string) => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted || !canVerify || gate.current.getState() !== 'ready') return;
    const session = gate.current;
    const searchAtStart = searchVersion.current;
    setReady(false);
    setWorking(true);
    setScanResult(null);
    setActionError('');
    setActionMessage('');
    setConfirmReverse(null);
    try {
      const device = `BiletFlow mobile / ${Platform.OS}`;
      const submitted = await session.submit<ScanResult | StaffTicket>(() => kind === 'reverse'
        ? staffApi.reverse(authenticatedFetch, eventId, value, device, controller.signal)
        : kind === 'manual'
          ? staffApi.checkIn(authenticatedFetch, eventId, value, device, controller.signal)
          : staffApi.scan(authenticatedFetch, eventId, value, device, controller.signal));
      if (!controller.signal.aborted && submitted.accepted) {
        if ('outcome' in submitted.result) setScanResult(submitted.result);
        else setActionMessage('Reversal complete');
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setActionError(failure instanceof Error ? failure.message : 'Result unknown. Refresh attendance and search before trying again.');
        if (failure instanceof StaffApiError && failure.status !== null && [401, 403, 404].includes(failure.status)) {
          setAccessDenied(true);
          setOnline(false);
          setEvent(null);
          setTickets([]);
          setCameraEnabled(false);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setWorking(false);
        await refreshData.current();
        if (!controller.signal.aborted && searchVersion.current === searchAtStart && query.trim().length >= 2) await loadSearch();
      }
    }
  };

  const acknowledge = () => {
    if (!gate.current.reset()) return;
    setReady(true);
    setScanResult(null);
    setActionError('');
    setActionMessage('');
    setConfirmReverse(null);
  };
  const openCamera = async () => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) return;
    setCameraError(false);
    try {
      const granted = permission?.granted ? permission : await requestPermission();
      if (granted.granted && lifecycle.current === controller && !controller.signal.aborted) setCameraEnabled(true);
    } catch {
      if (!controller.signal.aborted) setCameraError(true);
    }
  };
  const heading = scanResult ? outcomeLabels[scanResult.outcome] : '';

  return (
    <WorkspaceScreen title={event?.title ?? t('Staff check-in')} onRefresh={() => void refreshData.current()} refreshing={syncing}>
      {!!(event) && <Info tone="muted">{event.venue_name} / {formatDate(event.starts_at, event.timezone)}</Info>}
      <Panel>
        <Info>{t('Registered')}: {attendance?.registered ?? '-'}</Info>
        <Info>{t('Checked in')}: {attendance?.checked_in ?? '-'} / {t('Absent')}: {attendance?.absent ?? '-'}</Info>
        <Info tone="muted">{lastSync ? `${t('Last synchronized')}: ${formatDate(lastSync)}` : t('Syncing...')}</Info>
        {!!(syncError) && <Info tone="error">{t(syncError)}</Info>}
        <Action label={t('Refresh')} secondary disabled={syncing} onPress={() => void refreshData.current()} />
      </Panel>
      {!!(event && event.status !== 'published') && <Info tone="error">{t('Event is not open for check-in.')}</Info>}
      {!online && <Info tone="error">{t('Online verification is required. No ticket has been approved.')}</Info>}
      {!accessDenied && <>
        <Panel>
          <Info>{t('Scan one admission QR code at a time.')}</Info>
          {!!(permission && !permission.granted) && <Info tone="muted">{t('Camera permission is required to scan tickets.')}</Info>}
          {!!(permission && !permission.granted && !permission.canAskAgain) && <>
            <Info tone="muted">{t('Allow camera access in your device or browser settings.')}</Info>
            {!!(Platform.OS !== 'web') && <Action label={t('Open settings')} secondary onPress={() => void Linking.openSettings().catch(() => setCameraError(true))} />}
          </>}
          {!!(cameraError) && <Info tone="error">{t('Camera unavailable')}. {t('Use manual attendee search below.')}</Info>}
          {!!(cameraEnabled && permission?.granted && canVerify && ready && !cameraError) && <View style={{ height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: '#101828' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={working || !ready ? undefined : ({ data }) => { void perform('scan', data); }}
              onMountError={() => { setCameraError(true); setCameraEnabled(false); }} />
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 12, left: 12, right: 12, padding: 8, backgroundColor: '#101828' }}>
              <Text style={{ color: '#FFFFFF', textAlign: 'center' }}>{t('Admission QR only')}</Text>
            </View>
          </View>}
          {cameraEnabled
            ? <Action label={t('Close camera')} secondary onPress={() => setCameraEnabled(false)} />
            : <Action label={t(permission?.granted ? 'Open camera' : 'Allow camera')} disabled={!canVerify || working || !ready} onPress={() => void openCamera()} />}
          {!!(working) && <Info>{t('Checking ticket...')}</Info>}
          {!!(scanResult) && <View accessibilityLiveRegion="assertive" style={{ padding: 14, gap: 7, borderWidth: 2, borderRadius: 12, borderColor: scanResult.outcome === 'valid' ? colors.success : colors.danger }}>
            <Info tone={scanResult.outcome === 'valid' ? 'success' : 'error'}>{t(heading)}</Info>
            <Info>{t(scanResult.outcome === 'valid' ? 'Admission recorded by the server.' : 'Do not admit')}</Info>
            {!!(scanResult.ticket) && <>
              <Info>{scanResult.ticket.attendee_name}</Info>
              <Info tone="muted">{scanResult.ticket.ticket_type_name} / {scanResult.ticket.public_code}</Info>
            </>}
          </View>}
          {!!(actionMessage) && <Info tone="success">{t(actionMessage)}. {t('This ticket can be checked in again.')}</Info>}
          {!!(actionError) && <Info tone="error">{t(actionError)}</Info>}
          {!!(!ready && !working) && <Action label={t('Scan next ticket')} disabled={!canVerify} onPress={acknowledge} />}
        </Panel>
        <Panel>
          <Info>{t('Attendee search')}</Info>
          <FormField label={t('Name or ticket code')} value={query} maxLength={100} autoCapitalize="none" onChangeText={value => {
            searchVersion.current += 1;
            setSearching(false);
            setQuery(value);
            setTickets([]);
            setSearched(false);
            setSearchError('');
          }} onSubmitEditing={() => void loadSearch()} />
          <Action label={t(searching ? 'Searching...' : 'Search')} disabled={searching || !online || !event} onPress={() => void loadSearch()} />
          {!!(searchError) && <Info tone="error">{t(searchError)}</Info>}
          {!!(searched && tickets.length === 0 && !searchError) && <Info tone="muted">{t('No attendees found.')}</Info>}
          {tickets.map(ticket => <View key={ticket.public_code} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, gap: 10 }}>
            <Info>{ticket.attendee_name}</Info>
            <Info tone="muted">{ticket.ticket_type_name} / {ticket.public_code}</Info>
            <Info>{t(ticket.status)}</Info>
            {!!(ticket.status === 'valid') && <Action label={t('Check in')} disabled={!canVerify || working || !ready} onPress={() => void perform('manual', ticket.public_code)} />}
            {!!(ticket.status === 'checked_in') && <Action label={t('Undo check-in')} secondary danger disabled={!canVerify || working || !ready} onPress={() => { setConfirmReverse(ticket); setCameraEnabled(false); }} />}
          </View>)}
        </Panel>
        {!!(confirmReverse) && <Panel>
          <Info>{t("Undo this attendee's check-in?")}</Info>
          <Info>{confirmReverse.attendee_name} / {confirmReverse.public_code}</Info>
          <Action label={t('Confirm reversal')} danger disabled={working || !canVerify || !ready} onPress={() => void perform('reverse', confirmReverse.public_code)} />
          <Action label={t('Keep check-in')} secondary onPress={() => setConfirmReverse(null)} />
        </Panel>}
      </>}
      <Action label={t('Back to assigned events')} secondary onPress={() => router.replace('/staff')} />
    </WorkspaceScreen>
  );
}
