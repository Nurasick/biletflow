import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import { API_V1_URL } from '@/constants/api';
import type { AuthenticatedFetch } from '@/shared/api/orders';

function downloadInBrowser(url: string, filename: string) {
  if (typeof document === 'undefined') throw new Error('Downloads are not available in this browser.');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function requestPdf(fetcher: AuthenticatedFetch, path: string) {
  const response = await fetcher(path, { headers: { Accept: 'application/pdf' } });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail?: unknown }).detail
      : null;
    throw new Error(typeof detail === 'string' ? detail : 'Could not download the ticket PDF.');
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function saveOrSharePdf(bytes: Uint8Array, filename: string) {
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    downloadInBrowser(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }

  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('PDF sharing is unavailable on this device.');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share your ticket PDF' });
}

export async function downloadOrderTicketsPdf(fetcher: AuthenticatedFetch, orderNumber: string) {
  const bytes = await requestPdf(fetcher, `/orders/${encodeURIComponent(orderNumber)}/tickets.pdf`);
  await saveOrSharePdf(bytes, `biletflow-${orderNumber}.pdf`);
}

export async function downloadSingleTicketPdf(fetcher: AuthenticatedFetch, orderNumber: string, publicCode: string) {
  const bytes = await requestPdf(
    fetcher,
    `/orders/${encodeURIComponent(orderNumber)}/tickets/${encodeURIComponent(publicCode)}.pdf`,
  );
  await saveOrSharePdf(bytes, `biletflow-${publicCode}.pdf`);
}

export async function openEventCalendar(slug: string) {
  const url = `${API_V1_URL}/events/${encodeURIComponent(slug)}/calendar.ics`;
  if (Platform.OS === 'web') {
    downloadInBrowser(url, `${slug}.ics`);
    return;
  }
  await Linking.openURL(url);
}
