import { Platform } from 'react-native';

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

// Android emulators cannot reach the host machine through localhost. A physical
// device should set EXPO_PUBLIC_API_URL to the development machine's LAN address.
const defaultBaseUrl = Platform.select({
  android: 'http://10.0.2.2:8000',
  default: 'http://localhost:8000',
});

export const API_BASE_URL = (configuredBaseUrl || defaultBaseUrl).replace(/\/+$/, '');
export const API_V1_URL = `${API_BASE_URL}/api/v1`;
