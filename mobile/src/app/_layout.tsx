import '../../global.css';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View, useColorScheme as useSystemColorScheme } from 'react-native';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';

import { Wordmark } from '@/components/design';
import { Colors, Fonts, Stage } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { I18nProvider } from '@/i18n';

void SplashScreen.preventAutoHideAsync().catch(() => {});

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
  const [fontsLoaded, fontError] = useFonts({
    [Fonts.sans]: require('@/assets/fonts/Onest-Medium.ttf'),
    [Fonts.bold]: require('@/assets/fonts/Onest-Bold.ttf'),
    [Fonts.display]: require('@/assets/fonts/Onest-ExtraBold.ttf'),
  });
  const ready = !isRestoring && (fontsLoaded || !!fontError);
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const navigationTheme = isDark ? DarkTheme : DefaultTheme;

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

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <ThemeProvider value={{ ...navigationTheme, colors: {
      ...navigationTheme.colors, background: colors.background, card: colors.surface,
      text: colors.text, primary: colors.accent, border: colors.border,
    } }}>
      <StatusBar style={!ready || isDark ? 'light' : 'dark'} />
      {!ready ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, backgroundColor: Stage.background }}>
          <Wordmark onStage />
          <ActivityIndicator color={Stage.accent} />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={isLoggedIn}>
            {['(tabs)', 'about', 'home', 'explore', 'checkout', 'event-details',
              'ticket-selection', 'seat-selection', 'staff', 'staff-event',
              'support', 'support-new', 'support-case', 'notifications', 'account',
              'organizer', 'organizer-event', 'organizer-preview', 'organizer-image', 'admin', 'campaign-scan', 'report-event']
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
