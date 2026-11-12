import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { caseCategories, caseStatusLabels, supportApi, type CaseSummary, type SupportMode } from '@/shared/api/support';

export default function SupportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{mode?:string}>();
  const initialMode = params.mode === 'staff' ? 'staff' : 'requester';
  const {authenticatedFetch} = useAuth();
  const {t, formatDate} = useI18n();
  const [mode, setMode] = useState<SupportMode>(initialMode);
  useEffect(() => {setMode(initialMode);}, [initialMode]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useRef<() => void>(() => {});

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    let inFlight = false;
    let initial = true;
    const load = async () => {
      if (controller.signal.aborted || inFlight || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      inFlight = true;
      if (initial) {setLoading(true); setCases([]);}
      try {
        const result = await supportApi.list(authenticatedFetch, mode, controller.signal);
        if (!controller.signal.aborted) {setCases(result); setError('');}
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load support cases.');
      } finally {
        inFlight = false; initial = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    refresh.current = () => {void load();};
    void load();
    const timer = setInterval(() => {void load();}, 15000);
    const subscription = AppState.addEventListener('change', state => {if (state === 'active') void load();});
    return () => {controller.abort(); clearInterval(timer); subscription.remove(); refresh.current = () => {};};
  }, [authenticatedFetch, mode]));

  return <WorkspaceScreen title={t('Support')} onRefresh={() => refresh.current()} refreshing={loading}>
    <Info>{t('Conversations refresh automatically while this screen is open.')}</Info>
    <View style={{gap:8}}>
      <Action label={t('My requests')} secondary={mode !== 'requester'} onPress={() => setMode('requester')} />
      <Action label={t('Staff queue')} secondary={mode !== 'staff'} onPress={() => setMode('staff')} />
    </View>
    {mode === 'requester' ? <Panel>
      <Info>{t('For ticket or event questions, open support from the relevant event, order, or ticket.')}</Info>
      <Action label={t('Browse events')} secondary onPress={() => router.push('/')} />
      <Action label={t('Organizer platform support')} secondary onPress={() => router.push({pathname:'/support-new',params:{audience:'organizer'}})} />
      <Info>{t('Platform requests require an organizer profile.')}</Info>
    </Panel> : <Info>{t('Only cases you are authorized to answer appear here.')}</Info>}
    {!!error && <Info tone="error">{t(error)}</Info>}
    {!!(loading) && <Info>{t('Loading support cases...')}</Info>}
    {!!(!loading && !error && cases.length === 0) && <Panel><Info>{t('No support cases yet.')}</Info></Panel>}
    {cases.map(item => <Panel key={item.case_number}>
      <Info>{item.case_number}</Info>
      <Info>{t(caseCategories.find(category => category.value === item.category)?.label ?? item.category)}</Info>
      <Info>{t(caseStatusLabels[item.status])}</Info>
      <Info tone="muted">{t('Updated')}: {formatDate(item.updated_at)}</Info>
      <Action label={t('Open conversation')} onPress={() => router.push({pathname:'/support-case',params:{caseNumber:item.case_number,mode}})} />
    </Panel>)}
    <Action label={t('Refresh')} secondary disabled={loading} onPress={() => refresh.current()} />
  </WorkspaceScreen>;
}
