import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { Action, FormField, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { caseCategories, caseStatusLabels, supportApi, type CaseCategory, type CaseStatus, type CaseSummary, type StaffCaseFilters, type SupportMode } from '@/shared/api/support';

const statusOptions = Object.keys(caseStatusLabels) as CaseStatus[];
const nextOf = <T,>(values: readonly T[], current: T | undefined): T | undefined => {
  const index = current === undefined ? -1 : values.indexOf(current);
  return index + 1 < values.length ? values[index + 1] : undefined;
};

export default function SupportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{mode?:string}>();
  const initialMode = params.mode === 'staff' ? 'staff' : 'requester';
  const {authenticatedFetch} = useAuth();
  const {t, formatDate} = useI18n();
  const [mode, setMode] = useState<SupportMode>(initialMode);
  useEffect(() => {setMode(initialMode);}, [initialMode]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [filters, setFilters] = useState<StaffCaseFilters>({});
  const [eventFilter, setEventFilter] = useState('');
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
        const result = await supportApi.list(authenticatedFetch, mode, controller.signal, filters);
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
  }, [authenticatedFetch, mode, filters]));

  return <WorkspaceScreen title={t('Support')} onRefresh={() => refresh.current()} refreshing={loading}>
    <Info>{t('Conversations refresh automatically while this screen is open.')}</Info>
    <View style={{gap:8}}>
      <Action label={t('My requests')} secondary={mode !== 'requester'} onPress={() => setMode('requester')} />
      <Action label={t('Staff queue')} secondary={mode !== 'staff'} onPress={() => setMode('staff')} />
    </View>
    {mode === 'requester' ? <Panel>
      <Info>{t('For ticket or event questions, open support from the relevant event, order, or ticket.')}</Info>
      <Action label={t('Browse events')} secondary onPress={() => router.dismissTo('/')} />
      <Action label={t('Organizer platform support')} secondary onPress={() => router.push({pathname:'/support-new',params:{audience:'organizer'}})} />
      <Info>{t('Platform requests require an organizer profile.')}</Info>
    </Panel> : <Panel>
      <Info>{t('Only cases you are authorized to answer appear here.')}</Info>
      <Action secondary label={`${t('Status')}: ${filters.status ? t(caseStatusLabels[filters.status]) : t('All')} · ${t('Change')}`}
        onPress={() => setFilters(current => ({ ...current, status: nextOf(statusOptions, current.status) }))} />
      <Action secondary label={`${t('Category')}: ${filters.category ? t(caseCategories.find(item => item.value === filters.category)?.label ?? filters.category) : t('All')} · ${t('Change')}`}
        onPress={() => setFilters(current => ({ ...current, category: nextOf<CaseCategory>(caseCategories.map(item => item.value), current.category) }))} />
      <FormField label={t('Event ID (optional)')} value={eventFilter} onChangeText={setEventFilter} keyboardType="number-pad" maxLength={16}
        returnKeyType="search" onSubmitEditing={() => setFilters(current => ({ ...current, eventId: eventFilter.trim() ? Number(eventFilter) : undefined }))} />
      <Action secondary label={t('Apply filters')} onPress={() => setFilters(current => ({ ...current, eventId: eventFilter.trim() ? Number(eventFilter) : undefined }))} />
      {!!(filters.status || filters.category || filters.eventId) && <Action secondary label={t('Clear filters')} onPress={() => { setEventFilter(''); setFilters({}); }} />}
    </Panel>}
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
