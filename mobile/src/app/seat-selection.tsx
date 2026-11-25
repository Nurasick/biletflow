import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeading } from '@/components/workspace';
import { useI18n } from '@/i18n';
import { MaxContentWidth, Stage } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { eventsApi, type EventDetail, type EventSeat, type EventSeatMap } from '@/shared/api/events';

export default function SeatSelectionScreen() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { t, locale, formatDate, formatNumber } = useI18n();
  const params = useLocalSearchParams<{slug?:string|string[];campaignToken?:string|string[];accessToken?:string|string[]}>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const campaignToken = Array.isArray(params.campaignToken) ? params.campaignToken[0] : params.campaignToken;
  const accessToken = Array.isArray(params.accessToken) ? params.accessToken[0] : params.accessToken;
  const colors = useTheme();
  const [event,setEvent] = useState<EventDetail|null>(null);
  const [map,setMap] = useState<EventSeatMap|null>(null);
  const [selected,setSelected] = useState<EventSeat[]>([]);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    if (!slug) { setError('Choose an event first.'); setLoading(false); return; }
    const controller = new AbortController();
    void Promise.all([eventsApi.get(slug,controller.signal,accessToken),eventsApi.seats(slug,controller.signal,accessToken)])
      .then(([eventData,seatMap]) => { if(!controller.signal.aborted){setEvent(eventData);setMap(seatMap);} })
      .catch(failure => { if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Could not load the seat map.'); })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[slug,accessToken]);
  const seats = useMemo(()=>map?.sections.flatMap(section=>section.rows.flatMap(row=>row.seats))??[],[map]);
  const selectedTotal = selected.reduce((sum,seat)=>sum+(seat.price_minor??0),0);
  const grouped = useMemo(()=>{
    const result:Record<number,number>={};
    selected.forEach(seat=>{if(seat.ticket_type_id)result[seat.ticket_type_id]=(result[seat.ticket_type_id]??0)+1;});
    return result;
  },[selected]);
  const toggle=(seat:EventSeat)=>{
    if(seat.status!=='available')return;
    setSelected(current=>current.some(s=>s.event_seat_id===seat.event_seat_id)?current.filter(s=>s.event_seat_id!==seat.event_seat_id):current.length<20&&seat.ticket_type_id?[...current,seat]:current);
  };
  const go=()=>{
    if(!slug||!selected.length)return;
    if(!isLoggedIn){router.push('/login');return;}
    router.push({pathname:'/checkout',params:{slug,selection:JSON.stringify(grouped),seats:JSON.stringify(selected.map(s=>({id:s.event_seat_id,label:s.seat_label,ticket_type_id:s.ticket_type_id}))),...(campaignToken?{campaignToken}:{}),...(accessToken?{accessToken}:{})}});
  };
  return <ScreenFrame title={t('Select seats')}>
    <ScrollView style={{flex:1}} contentContainerStyle={{alignSelf:'center',width:'100%',maxWidth:MaxContentWidth,padding:18,paddingBottom:24}}>
      <ScreenHeading>{event?.title??t('Select seats')}</ScreenHeading>
      {event&&<ThemedText style={{marginTop:4,color:colors.muted,fontSize:13}}>{formatDate(event.starts_at,event.timezone)} · {event.venue_name}</ThemedText>}
      {loading?<View style={{alignItems:'center',padding:36}}><ActivityIndicator color={colors.accent}/><ThemedText style={{marginTop:10,color:colors.muted}}>{t('Loading event and ticket types...')}</ThemedText></View>:error?<ThemedText style={{padding:24,color:colors.text}}>{t(error)}</ThemedText>:<>
        {!!map&&<><View style={{marginTop:20,padding:12,borderRadius:12,backgroundColor:Stage.background,alignItems:'center'}}><ThemedText style={{color:Stage.accent,fontSize:12,fontWeight:'800',letterSpacing:1.5}}>{t('STAGE')}</ThemedText></View>
          {map.sections.map(section=><View key={section.section_id} style={{marginTop:16,padding:12,borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:colors.surface}}><ThemedText style={{marginBottom:9,color:colors.text,fontWeight:'800'}}>{section.name}</ThemedText>{section.rows.map(row=><View key={row.row_id} style={{marginBottom:10}}><ThemedText style={{marginBottom:4,color:colors.muted,fontSize:11}}>{t('Row {row}',{row:row.name})}</ThemedText><View style={{flexDirection:'row',flexWrap:'wrap',gap:5}}>{row.seats.map(seat=>{const active=selected.some(s=>s.event_seat_id===seat.event_seat_id);const enabled=seat.status==='available'&&(active||!!seat.ticket_type_id&&(selected.length<20||active));const tone=active?colors.button:seat.status==='sold'||seat.status==='held'?colors.muted:seat.is_accessible?colors.success:colors.accent;return <Pressable key={seat.event_seat_id} accessibilityRole="button" accessibilityLabel={`${seat.accessible_label}, ${t(active?'selected':seat.status)}`} accessibilityState={{disabled:!enabled,selected:active}} disabled={!enabled} onPress={()=>toggle(seat)} style={{minWidth:38,minHeight:38,paddingHorizontal:5,borderRadius:8,alignItems:'center',justifyContent:'center',backgroundColor:active?colors.button:seat.status==='sold'||seat.status==='held'?colors.raised:colors.surface,borderWidth:1,borderColor:tone,opacity:enabled?1:0.5}}><ThemedText style={{fontSize:10,color:active?'#FFFFFF':colors.text,fontWeight:'700'}}>{seat.seat_number}{seat.is_accessible?' ♿':''}</ThemedText></Pressable>;})}</View></View>)}</View>)}</>}
        <View style={{marginTop:14,flexDirection:'row',flexWrap:'wrap',gap:12}}>{['available','held','sold','unavailable'].map(status=><ThemedText key={status} style={{color:colors.muted,fontSize:11}}>{t(status)}</ThemedText>)}</View>
        <View style={{marginTop:16,borderWidth:1,borderColor:colors.border,borderRadius:13,overflow:'hidden',backgroundColor:colors.surface}}>
          <ThemedText style={{padding:12,color:colors.text,fontWeight:'800'}}>{t('Selected seats ({count})',{count:formatNumber(selected.length)})}</ThemedText>
          {selected.map(seat=>(
            <View key={seat.event_seat_id} style={{padding:12,borderTopWidth:1,borderTopColor:colors.border,flexDirection:'row',justifyContent:'space-between'}}>
              <ThemedText style={{color:colors.text}}>{seat.seat_label}{seat.is_accessible?' · ♿':''}</ThemedText>
              <ThemedText style={{color:colors.text}}>{new Intl.NumberFormat(locale,{style:'currency',currency:seat.currency??'KZT',maximumFractionDigits:0}).format((seat.price_minor??0)/100)}</ThemedText>
            </View>
          ))}
        </View>
      </>}
    </ScrollView>
    <View style={{borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.surface,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><View><ThemedText style={{color:colors.muted,fontSize:11}}>{t('Total')}</ThemedText><ThemedText style={{color:colors.text,fontWeight:'900'}}>{new Intl.NumberFormat(locale,{style:'currency',currency:seats.find(s=>s.currency)?.currency??'KZT',maximumFractionDigits:0}).format(selectedTotal/100)}</ThemedText></View><Pressable disabled={!selected.length||loading||!!error} onPress={go} style={{paddingHorizontal:20,paddingVertical:13,borderRadius:12,backgroundColor:colors.button,opacity:selected.length&&!loading&&!error?1:.5}}><ThemedText style={{color:'#FFF',fontWeight:'800'}}>{t('Continue')}</ThemedText></Pressable></View>
  </ScreenFrame>;
}
