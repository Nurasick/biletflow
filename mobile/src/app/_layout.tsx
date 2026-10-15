import '../../global.css';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, View, useColorScheme as useSystemColorScheme } from 'react-native';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import LoginScreen from './login';

SplashScreen.preventAutoHideAsync();

function getBrowserColorScheme(): 'light' | 'dark' | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutContent />
    </AuthProvider>
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
      ) : isLoggedIn ? (
        <Stack screenOptions={{ headerShown: false }} />
      ) : (
        <LoginScreen />
      )}
    </ThemeProvider>
  );
}
