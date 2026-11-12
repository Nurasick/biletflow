import '../../global.css';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, View, useColorScheme as useSystemColorScheme } from 'react-native';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { I18nProvider } from '@/i18n';

SplashScreen.preventAutoHideAsync();

function getBrowserColorScheme(): 'light' | 'dark' | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <RootLayoutContent />
      </AuthProvider>
    </I18nProvider>
  );
}

function RootLayoutContent() {
  const systemColorScheme = useSystemColorScheme();
  const [browserColorScheme, setBrowserColorScheme] = useState(getBrowserColorScheme);
  const colorScheme = browserColorScheme ?? systemColorScheme;
  const { setColorScheme } = useNativeWindColorScheme();
  const { isLoggedIn, isRestoring } = useAuth();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateBrowserColorScheme = () => {
      setBrowserColorScheme(mediaQuery.matches ? 'dark' : 'light');
    };

    updateBrowserColorScheme();
    mediaQuery.addEventListener('change', updateBrowserColorScheme);
    return () => mediaQuery.removeEventListener('change', updateBrowserColorScheme);
  }, []);

  useEffect(() => {
    setColorScheme(colorScheme === 'dark' ? 'dark' : 'light');
  }, [colorScheme, setColorScheme]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isRestoring ? (
        <View className="flex-1 bg-[#F5F5F0] dark:bg-[#101828]" />
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={isLoggedIn}>
            {['index', 'about', 'home', 'explore', 'checkout', 'event-details', 'tickets',
              'ticket-selection', 'seat-selection', 'staff', 'staff-event', 'workspace',
              'support', 'support-new', 'support-case', 'notifications', 'account']
              .map(name => <Stack.Screen key={name} name={name} />)}
          </Stack.Protected>
          <Stack.Protected guard={!isLoggedIn}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="verify-email" />
        </Stack>
      )}
    </ThemeProvider>
  );
}
