import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n';
import { managementApi } from '@/shared/api/management';

export default function OrganizerImageScreen() {
  const params=useLocalSearchParams<{eventId?:string|string[]}>();const eventId=Number(Array.isArray(params.eventId)?params.eventId[0]:params.eventId);
  const camera=useRef<CameraView>(null);const [permission,requestPermission]=useCameraPermissions();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const {authenticatedFetch}=useAuth();const {t}=useI18n();const router=useRouter();
  const upload=async(data:string,mime:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await managementApi.uploadImage(authenticatedFetch,eventId,`data:${mime};base64,${data}`);setNotice('Event image uploaded.');setTimeout(()=>router.back(),500);}catch(failure){setError(failure instanceof Error?failure.message:'Could not upload event image.');}finally{setBusy(false);}};
  const capture=async()=>{if(!camera.current)return;try{const picture:CameraCapturedPicture|null=await camera.current.takePictureAsync({quality:.72,base64:true});if(!picture?.base64)throw new Error('The camera did not return an image.');await upload(picture.base64,picture.uri.toLowerCase().endsWith('.png')?'image/png':'image/jpeg');}catch(failure){setError(failure instanceof Error?failure.message:'Could not capture image.');}};
  const choose=async()=>{setError('');try{const access=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!access.granted){setError(access.canAskAgain?'Photo library access is needed to select an event image.':'Photo library access is disabled. Enable it in device settings.');return;}const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.82,base64:true});if(result.canceled)return;const asset=result.assets[0];if(!asset.base64)throw new Error('The selected image could not be read.');await upload(asset.base64,asset.mimeType??'image/jpeg');}catch(failure){setError(failure instanceof Error?failure.message:'Could not select this image.');}};
  return <WorkspaceScreen title={t('Add event image')}>
    <Panel><Info>{t('Event gallery image')}</Info><Info tone="muted">{t('Capture a clear event photo. The server accepts JPEG, PNG, or WebP images up to 2 MB and stores up to five images per event.')}</Info></Panel>
    <Action secondary disabled={busy} label={t('Choose from photo library')} onPress={()=>void choose()} />
    {!permission?.granted?<Panel><Info>{t('Camera access is needed to capture an event image.')}</Info><Action label={t(permission?.canAskAgain===false?'Open device settings':'Allow camera')} onPress={()=>permission?.canAskAgain===false?void Linking.openSettings():void requestPermission()} /></Panel>:<><View style={{height:390,overflow:'hidden',borderRadius:18}}><CameraView ref={camera} style={{flex:1}} facing="back" onMountError={()=>setError(t('Camera could not start. Check camera access in device settings and try again.'))}/></View><Action label={t(busy?'Uploading…':'Capture and upload image')} disabled={busy} onPress={()=>void capture()} /></>}
    {!!error&&<Info tone="error">{t(error)}</Info>}{!!notice&&<Info tone="success">{t(notice)}</Info>}<Action secondary label={t('Cancel')} onPress={()=>router.back()} />
  </WorkspaceScreen>;
}
