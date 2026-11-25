import { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Action, FormField, Info, Panel, useWorkspaceColors, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { createScanSession } from '@/lib/scan-session';
import { findCachedAdmission, listQueuedAdmissions, markQueuedConflict, queueOfflineAdmission, removeQueuedAdmission, storeAdmissionSnapshot, type QueuedAdmission } from '@/lib/offline-checkin';
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
  const [actionKind, setActionKind] = useState<'reverse' | 'offline' | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [tickets, setTickets] = useState<StaffTicket[]>([]);
  const [offlineQueue,setOfflineQueue]=useState<QueuedAdmission[]>([]);
  const [offlineBusy,setOfflineBusy]=useState(false);
  const [offlineNotice,setOfflineNotice]=useState('');
  const [offlineError,setOfflineError]=useState('');
  const [confirmReverse, setConfirmReverse] = useState<StaffTicket | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const gate = useRef(createScanSession());
  const refreshData = useRef<() => Promise<void>>(async () => {});
  const searchVersion = useRef(0);
  const offlineScanBusy=useRef(false);

  const canVerify = focused && foreground && online && !accessDenied && event?.status === 'published';
  const canOfflineScan = focused && foreground && !online && !accessDenied && event?.status === 'published' && Platform.OS !== 'web';

  const refreshOfflineQueue = async () => setOfflineQueue(await listQueuedAdmissions(eventId));
  const syncOfflineQueue = async (signal?: AbortSignal): Promise<boolean> => {
    const entries = (await listQueuedAdmissions(eventId)).filter(item => item.state === 'pending');
    if (!entries.length) {
      if (!signal?.aborted) await refreshOfflineQueue();
      return false;
    }
    let syncedCount = 0;
    let syncFailed = false;
    for (let offset = 0; offset < entries.length; offset += 50) {
      const batch = entries.slice(offset, offset + 50);
      try {
        const results = await staffApi.offlineSync(
          authenticatedFetch,
          eventId,
          batch.map(({ client_scan_id, public_code, qr_payload, scanned_at }) => ({ client_scan_id, public_code, qr_payload, scanned_at })),
        );
        for (const result of results) {
          if (result.outcome === 'valid') {
            await removeQueuedAdmission(eventId, result.client_scan_id);
            syncedCount += 1;
          } else {
            await markQueuedConflict(eventId, result.client_scan_id, `Server result: ${result.outcome}`);
          }
        }
      } catch (failure) {
        syncFailed = true;
        if (!signal?.aborted) {
          setOfflineError(failure instanceof Error ? failure.message : 'Could not sync offline check-ins.');
        }
        break;
      }
    }
    if (!signal?.aborted) {
      if (!syncFailed) setOfflineError('');
      await refreshOfflineQueue();
    }
    return syncedCount > 0;
  };
  const cacheOfflineTickets=async()=>{
    if(!Number.isSafeInteger(eventId)||eventId<1||!online||offlineBusy)return;
    setOfflineBusy(true);setOfflineError('');setOfflineNotice('');
    try{
      const all=[];
      for(let offset=0;offset<2000;offset+=100){const page=await staffApi.offlineSnapshot(authenticatedFetch,eventId,offset);all.push(...page);if(page.length<100)break;}
      if(all.length===2000&&(await staffApi.offlineSnapshot(authenticatedFetch,eventId,2000)).length)throw new Error('Offline cache is limited to 2,000 tickets per event.');
      await storeAdmissionSnapshot(eventId,all);setOfflineNotice(t('Cached {count} valid tickets securely on this device.',{count:all.length}));
    }catch(failure){setOfflineError(failure instanceof Error?failure.message:'Could not cache tickets for offline verification.');}
    finally{setOfflineBusy(false);}
  };
  const handleScan = async (raw: string) => {
    if (canVerify) { await perform('scan', raw); return; }
    if (!canOfflineScan || working || !ready || offlineScanBusy.current) return;
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) return;
    offlineScanBusy.current = true;
    setWorking(true);
    setReady(false);
    setScanResult(null);
    setActionError('');
    setActionMessage('');
    setActionKind(null);
    setConfirmReverse(null);
    try {
      const cached = await findCachedAdmission(eventId, raw);
      if (!cached) throw new Error('This QR is not in the secure offline snapshot. Do not admit this attendee.');
      const existing = await listQueuedAdmissions(eventId);
      if (existing.some(item => item.public_code === cached.public_code)) throw new Error('This ticket is already waiting for online verification. Do not admit twice.');
      await queueOfflineAdmission(eventId, cached.public_code, raw);
      if (!controller.signal.aborted) {
        await refreshOfflineQueue();
        setActionKind('offline');
        setActionMessage('Offline check-in queued for server verification. Do not admit until it syncs.');
        setReady(false);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setActionError(failure instanceof Error ? failure.message : 'Could not queue offline check-in.');
        setReady(false);
      }
    } finally {
      offlineScanBusy.current = false;
      if (!controller.signal.aborted) setWorking(false);
    }
  };

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
    setActionKind(null);
    setConfirmReverse(null);
    setCameraEnabled(false);
    setTickets([]);
    setSearching(false);
    setSearchError('');
    setLastSync(null);
    setSearched(false);
    void refreshOfflineQueue();
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
          if ((await syncOfflineQueue(controller.signal)) && !controller.signal.aborted) {
            const freshCounts = await staffApi.attendance(authenticatedFetch, eventId, controller.signal);
            if (!controller.signal.aborted) setAttendance(freshCounts);
          }
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
    setActionKind(null);
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
        else { setActionKind('reverse'); setActionMessage('Reversal complete'); }
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
    if (offlineScanBusy.current) return;
    if (gate.current.getState() !== 'ready' && !gate.current.reset()) return;
    setReady(true);
    setScanResult(null);
    setActionError('');
    setActionMessage('');
    setActionKind(null);
    setConfirmReverse(null);
  };
  const openCamera = async () => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) return;
    setCameraError(false);
    try {
      const granted = permission?.granted ? permission : await requestPermission();
      if (granted.granted && lifecycle.current === controller && !controller.signal.aborted && (canVerify || canOfflineScan)) setCameraEnabled(true);
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
      {!!event&&<Panel><Info>{t('Offline check-in')}</Info><Info tone="muted">{t('Cache current valid admission QR codes before doors open. Offline scans are only queued; the server must verify them after connection returns.')}</Info><Action secondary label={t(offlineBusy?'Caching secure snapshot...':'Cache valid tickets for offline use')} disabled={!online||offlineBusy||Platform.OS==='web'} onPress={()=>void cacheOfflineTickets()}/>{Platform.OS==='web'&&<Info tone="muted">{t('Secure offline cache is available on iOS and Android only.')}</Info>}{!!offlineNotice&&<Info tone="success">{offlineNotice}</Info>}{!!offlineError&&<Info tone="error">{t(offlineError)}</Info>}</Panel>}
      {!!offlineQueue.length&&<Panel><Info>{t('Offline queue')} · {offlineQueue.length}</Info>{offlineQueue.map(item=><View key={item.client_scan_id} style={{borderTopWidth:1,borderTopColor:colors.border,paddingVertical:9,gap:4}}><Info>{item.public_code} · {t(item.state==='pending'?'Waiting for server verification':'Server conflict')}</Info><Info tone="muted">{formatDate(item.scanned_at,event?.timezone)}{item.detail?` · ${t(item.detail)}`:''}</Info>{item.state==='conflict'&&<Action secondary label={t('Dismiss conflict')} onPress={()=>void removeQueuedAdmission(eventId,item.client_scan_id).then(refreshOfflineQueue)}/>}</View>)}</Panel>}
      {!accessDenied && <>
        <Panel>
          <Info>{t('Scan one admission QR code at a time.')}</Info>
          {!!(permission && !permission.granted) && <Info tone="muted">{t('Camera permission is required to scan tickets.')}</Info>}
          {!!(permission && !permission.granted && !permission.canAskAgain) && <>
            <Info tone="muted">{t('Allow camera access in your device or browser settings.')}</Info>
            {!!(Platform.OS !== 'web') && <Action label={t('Open settings')} secondary onPress={() => void Linking.openSettings().catch(() => setCameraError(true))} />}
          </>}
          {!!(cameraError) && <Info tone="error">{t('Camera unavailable')}. {t('Use manual attendee search below.')}</Info>}
            {!!(cameraEnabled && permission?.granted && (canVerify || canOfflineScan) && ready && !cameraError) && <View style={{ height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: '#101828' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={working || !ready ? undefined : ({ data }) => { void handleScan(data); }}
              onMountError={() => { setCameraError(true); setCameraEnabled(false); }} />
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 12, left: 12, right: 12, padding: 8, backgroundColor: '#101828' }}>
              <Text style={{ color: '#FFFFFF', textAlign: 'center' }}>{t(online?'Admission QR only':'Offline cache match only · queued, not approved')}</Text>
            </View>
          </View>}
          {cameraEnabled
            ? <Action label={t('Close camera')} secondary onPress={() => setCameraEnabled(false)} />
            : <Action label={t(permission?.granted ? 'Open camera' : 'Allow camera')} disabled={(!canVerify && !canOfflineScan) || working || !ready} onPress={() => void openCamera()} />}
          {!!(working) && <Info>{t('Checking ticket...')}</Info>}
          {!!(scanResult) && <View accessibilityLiveRegion="assertive" style={{ padding: 14, gap: 7, borderWidth: 2, borderRadius: 12, borderColor: scanResult.outcome === 'valid' ? colors.success : colors.danger }}>
            <Info tone={scanResult.outcome === 'valid' ? 'success' : 'error'}>{t(heading)}</Info>
            <Info>{t(scanResult.outcome === 'valid' ? 'Admission recorded by the server.' : 'Do not admit')}</Info>
            {!!(scanResult.ticket) && <>
              <Info>{scanResult.ticket.attendee_name}</Info>
              <Info tone="muted">{scanResult.ticket.ticket_type_name} / {scanResult.ticket.public_code}</Info>
            </>}
          </View>}
          {!!(actionMessage) && <Info tone="success">{actionKind === 'reverse' ? `${t(actionMessage)}. ${t('This ticket can be checked in again.')}` : t(actionMessage)}</Info>}
          {!!(actionError) && <Info tone="error">{t(actionError)}</Info>}
          {!!(!ready && !working) && <Action label={t('Scan next ticket')} disabled={!canVerify && !canOfflineScan} onPress={acknowledge} />}
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
