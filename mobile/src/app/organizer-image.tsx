import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { Button, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { managementApi } from '@/shared/api/management';

export default function OrganizerImageScreen() {
  const params=useLocalSearchParams<{eventId?:string|string[]}>(); const eventId=Number(Array.isArray(params.eventId)?params.eventId[0]:params.eventId);
  const camera=useRef<CameraView>(null); const [permission,requestPermission]=useCameraPermissions(); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const {authenticatedFetch}=useAuth(); const {t}=useI18n(); const router=useRouter();
  const capture=async()=>{if(busy||!camera.current)return;setBusy(true);setError('');setNotice('');try{const picture:CameraCapturedPicture|null=await camera.current.takePictureAsync({quality:0.72,base64:true});if(!picture?.base64)throw new Error('The camera did not return an image.');const mime=picture.uri.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';await managementApi.uploadImage(authenticatedFetch,eventId,`data:${mime};base64,${picture.base64}`);setNotice('Event image uploaded.');setTimeout(()=>router.back(),500);}catch(failure){setError(failure instanceof Error?failure.message:'Could not upload event image.');}finally{setBusy(false);}};
  return <WorkspaceScreen title={t('Add event image')}>
    <Panel><Info>{t('Event gallery image')}</Info><Info tone="muted">{t('Capture a clear event photo. The server accepts JPEG, PNG, or WebP images up to 2 MB and stores up to five images per event.')}</Info></Panel>
    {!permission?.granted?<Panel><Info>{t('Camera access is needed to capture an event image.')}</Info><Action label={t('Allow camera')} onPress={()=>void requestPermission()} /></Panel>:<><View style={{height:390,overflow:'hidden',borderRadius:18}}><CameraView ref={camera} style={{flex:1}} facing="back" /></View><Button title={t(busy?'Uploading…':'Capture and upload image')} disabled={busy} onPress={()=>void capture()} /></>}
    {!!error&&<Info tone="error">{t(error)}</Info>}{!!notice&&<Info tone="success">{t(notice)}</Info>}
    <Action secondary label={t('Cancel')} onPress={()=>router.back()} />
  </WorkspaceScreen>;
}
