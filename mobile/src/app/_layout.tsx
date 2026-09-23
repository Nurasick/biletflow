import '../../global.css';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, useColorScheme as useSystemColorScheme } from 'react-native';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import LoginScreen from './login';
import { useAuth } from '@/hooks/use-auth';

SplashScreen.preventAutoHideAsync();

function getBrowserColorScheme(): 'light' | 'dark' | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function RootLayout() {
  const systemColorScheme = useSystemColorScheme();
  const [browserColorScheme, setBrowserColorScheme] = useState(getBrowserColorScheme);
  const colorScheme = browserColorScheme ?? systemColorScheme;
  const { setColorScheme } = useNativeWindColorScheme();
  const { isLoggedIn } = useAuth();

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

  // Show login screen if not authenticated
  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
