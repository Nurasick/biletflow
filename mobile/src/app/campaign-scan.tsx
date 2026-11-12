import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useI18n } from '@/i18n';

function campaignFromUrl(raw: string): { slug: string; token: string } | null {
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
    const token = url.searchParams.get('c');
    return match && token && token.length <= 64 ? { slug: match[1], token } : null;
  } catch { return null; }
}

export default function CampaignScanScreen() {
  const router = useRouter(); const { t } = useI18n(); const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState(''); const scanning = useRef(false);
  const handle = (raw: string) => {
    if (scanning.current) return;
    const campaign = campaignFromUrl(raw);
    if (!campaign) { setError(t('This is not a BiletFlow campaign QR. Admission ticket QRs are not accepted here.')); return; }
    scanning.current = true;
    router.replace({ pathname: '/event-details', params: { slug: campaign.slug, campaignToken: campaign.token } });
  };
  return <WorkspaceScreen title={t('Scan campaign QR')}>
    <Panel><Info>{t('Promotional campaign')}</Info><Info tone="muted">{t('Scan a campaign QR to open its event. The discount will be checked by the server and shown before checkout. Campaign QR codes never grant event admission.')}</Info></Panel>
    {!permission?.granted ? <Panel><Info>{t('Camera access is needed to scan a campaign QR.')}</Info><Action label={t('Allow camera')} onPress={() => void requestPermission()} /></Panel> : <View style={{ height: 390, overflow:'hidden', borderRadius:18 }}><CameraView style={{ flex:1 }} facing="back" barcodeScannerSettings={{ barcodeTypes:['qr'] }} onBarcodeScanned={({data})=>handle(data)} /></View>}
    {!!error && <Panel><Info tone="error">{error}</Info><Action secondary label={t('Try another QR')} onPress={()=>setError('')} /></Panel>}
    <Action secondary label={t('Cancel')} onPress={()=>router.back()} />
  </WorkspaceScreen>;
}
