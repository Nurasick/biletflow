import { useCallback, useRef, useState } from 'react';
import { AppState, Switch, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Action, FormField, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import {
  caseCategories, caseStatusLabels, caseTransitions, supportApi, visibleMessages,
  type SupportCase, type SupportMode,
} from '@/shared/api/support';

export default function SupportCaseScreen() {
  const params = useLocalSearchParams<{caseNumber?:string;mode?:string}>();
  const number = Array.isArray(params.caseNumber) ? params.caseNumber[0] : params.caseNumber;
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode: SupportMode = rawMode === 'staff' ? 'staff' : 'requester';
  return <Conversation key={mode+':'+number} caseNumber={number ?? ''} mode={mode} />;
}

function Conversation({caseNumber,mode}: {caseNumber:string;mode:SupportMode}) {
  const {authenticatedFetch} = useAuth();
  const {t,formatDate} = useI18n();
  const [detail,setDetail] = useState<SupportCase | null>(null);
  const [draft,setDraft] = useState('');
  const [internal,setInternal] = useState(false);
  const [assignee,setAssignee] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [refreshError,setRefreshError] = useState('');
  const active = useRef(false);
  const mutationLock = useRef(false);
  const version = useRef(0);
  const refresh = useRef<() => void>(() => {});

  useFocusEffect(useCallback(() => {
    active.current = true;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (controller.signal.aborted || inFlight || mutationLock.current || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      if (!caseNumber) {setRefreshError('Choose a support case first.');setLoading(false);return;}
      inFlight = true;
      const startedVersion = version.current;
      try {
        const result = await supportApi.read(authenticatedFetch,caseNumber,mode,controller.signal);
        if (!controller.signal.aborted && version.current === startedVersion) {setDetail(result);setRefreshError('');}
      } catch (failure) {
        if (!controller.signal.aborted && version.current === startedVersion) setRefreshError(failure instanceof Error ? failure.message : 'Could not load the conversation.');
      } finally {
        inFlight=false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    refresh.current=()=>{void load();};
    void load();
    const timer=setInterval(()=>{void load();},10000);
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return ()=>{active.current=false;version.current++;controller.abort();clearInterval(timer);subscription.remove();refresh.current=()=>{};};
  },[authenticatedFetch,caseNumber,mode]));

  const mutate=async(operation:()=>Promise<SupportCase>,clearDraft=false)=>{
    if(mutationLock.current)return;
    mutationLock.current=true;version.current++;setBusy(true);setError('');
    try{
      const updated=await operation();
      if(active.current){setDetail(updated);setRefreshError('');if(clearDraft)setDraft('');}
    }catch(failure){
      if(active.current)setError(failure instanceof Error?failure.message:'The support request could not be completed.');
    }finally{
      mutationLock.current=false;
      if(active.current)setBusy(false);
    }
  };
  const send=()=>void mutate(()=>supportApi.reply(authenticatedFetch,caseNumber,mode,draft,internal),true);
  const assignToMe=()=>void mutate(async()=>{
    const user=await supportApi.currentUser(authenticatedFetch);
    return supportApi.assign(authenticatedFetch,caseNumber,user.id);
  });

  return <WorkspaceScreen title={t('Support conversation')} onRefresh={()=>refresh.current()} refreshing={loading}>
    <Info>{caseNumber}</Info>
    <Info tone="muted">{t('Conversations refresh automatically while this screen is open.')}</Info>
    {!!(loading)&&<Info>{t('Loading conversation...')}</Info>}
    {!!refreshError&&<Info tone="error">{t(refreshError)}</Info>}
    <Action label={t('Refresh conversation')} secondary disabled={loading||busy} onPress={()=>refresh.current()} />
    {!!(detail)&&<>
      <Panel>
        <Info>{t(caseStatusLabels[detail.status])}</Info>
        <Info>{t(caseCategories.find(category=>category.value===detail.category)?.label??detail.category)}</Info>
        {!!(detail.context.event_title)&&<Info>{t('Event')}: {detail.context.event_title}</Info>}
        {!!(detail.context.order_number)&&<Info>{t('Order')}: {detail.context.order_number}</Info>}
        {!!(detail.context.ticket_code)&&<Info>{t('Ticket')}: {detail.context.ticket_code}</Info>}
        {!!(mode==='staff')&&<Info>{t('Assigned staff ID')}: {detail.assigned_to_user_id??t('Unassigned')}</Info>}
      </Panel>
      {visibleMessages(detail,mode).map(message=><Panel key={message.id}>
        <Info>{t(message.is_internal_note?'Internal note':message.sender==='requester'?'Requester':message.sender==='staff'?'Support staff':'System')}</Info>
        <Info>{message.body}</Info>
        <Info tone="muted">{formatDate(message.created_at)}</Info>
      </Panel>)}
      {!!(mode==='staff')&&<Panel>
        <Info>{t('Staff actions')}</Info>
        <Action label={t('Assign to me')} secondary disabled={busy} onPress={assignToMe} />
        <FormField label={t('Staff user ID')} keyboardType="number-pad" value={assignee} onChangeText={setAssignee} editable={!busy} maxLength={16} />
        <Action label={t('Assign staff')} secondary disabled={busy||!assignee.trim()} onPress={()=>void mutate(()=>supportApi.assign(authenticatedFetch,caseNumber,Number(assignee)))} />
        {!!(detail.assigned_to_user_id!=null)&&<Action label={t('Unassign')} secondary disabled={busy} onPress={()=>void mutate(()=>supportApi.assign(authenticatedFetch,caseNumber,null))} />}
        {caseTransitions[detail.status].map(status=><Action key={status} label={t(caseStatusLabels[status])} secondary disabled={busy} onPress={()=>void mutate(()=>supportApi.transition(authenticatedFetch,detail,status))} />)}
        <Info tone="muted">{t('The server checks staff permissions and allowed status changes.')}</Info>
      </Panel>}
      {!!(detail.status==='resolved'&&mode==='requester')&&<Info>{t('Sending a reply reopens this support case.')}</Info>}
      <FormField label={t('Your message')} value={draft} onChangeText={setDraft} multiline maxLength={5000} editable={!busy} textAlignVertical="top" style={{minHeight:110}} />
      <Info tone="muted">{draft.length} / 5000</Info>
      {!!(mode==='staff')&&<View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <Info>{t('Internal note (staff only)')}</Info>
        <Switch accessibilityLabel={t('Internal note (staff only)')} value={internal} onValueChange={setInternal} disabled={busy} />
      </View>}
      {!!error&&<Info tone="error">{t(error)}</Info>}
      <Action label={t(busy?'Sending...':internal&&mode==='staff'?'Save internal note':'Send reply')} disabled={busy||!draft.trim()} onPress={send} />
      <Info tone="muted">{t('Do not include passwords or payment-card information.')}</Info>
    </>}
  </WorkspaceScreen>;
}
