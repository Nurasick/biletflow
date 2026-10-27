import { useState } from 'react';
import { StatusBar, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const { login, loading, error } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }

    setFormError(null);
    const signedIn = await login(email, password, rememberMe);
    if (signedIn) {
      router.replace('/');
    }
  };

  const displayedError = formError ?? error;

  return (
    <SafeAreaView className="flex-1 bg-[#182230]">
      <StatusBar barStyle="light-content" backgroundColor="#101828" />

      <View className="absolute right-0 top-0 h-64 w-64 rounded-full bg-[#FF5C35] opacity-10 blur-3xl" />

      <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <ThemedView className="relative z-10 flex-1 px-6">
          <View className="mb-12 flex-row gap-2">
            <View className="h-7 w-6 rounded bg-[#FF5C35]" />
            <ThemedText className="text-2xl font-extrabold">
              Bilet<ThemedText className="text-[#FF5C35]">Flow</ThemedText>
            </ThemedText>
          </View>

          <View className="mb-7">
            <ThemedText className="mb-2 text-xs font-bold tracking-widest text-[#FF5C35]">WELCOME BACK</ThemedText>
            <ThemedText className="mb-2 text-3xl font-bold leading-tight">
              Your next great{'\n'}night starts here.
            </ThemedText>
            <ThemedText className="text-sm text-[#98A2B3]">
              Sign in to access your tickets, saved events and faster checkout.
            </ThemedText>
          </View>

          {displayedError && (
            <ThemedText className="mb-4 rounded bg-red-900/20 px-3 py-2 text-sm text-red-500">
              {displayedError}
            </ThemedText>
          )}

          <View className="mb-4">
            <ThemedText className="mb-2 text-sm font-semibold">Email address</ThemedText>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              editable={!loading}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#98A2B3"
              className="rounded-lg border border-[#344054] bg-[#101828] px-4 py-3 text-base text-[#F5F5F0]"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setFormError(null);
              }}
            />
          </View>

          <View className="mb-6">
            <View className="mb-2 flex-row items-center justify-between">
              <ThemedText className="text-sm font-semibold">Password</ThemedText>
              <TouchableOpacity>
                <ThemedText className="text-xs font-semibold text-[#FF5C35]">Forgot password?</ThemedText>
              </TouchableOpacity>
            </View>
            <View className="flex-row items-center rounded-lg border border-[#344054] bg-[#101828]">
              <TextInput
                autoComplete="current-password"
                editable={!loading}
                placeholder="????????"
                placeholderTextColor="#98A2B3"
                secureTextEntry={!showPassword}
                className="flex-1 px-4 py-3 text-base text-[#F5F5F0]"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setFormError(null);
                }}
              />
              <TouchableOpacity onPress={() => setShowPassword((visible) => !visible)} className="px-4">
                <ThemedText className="text-lg">{showPassword ? '?' : '?'}</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <View className="mb-6 gap-3">
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberMe }}
                onPress={() => setRememberMe((remembered) => !remembered)}
                className={`h-5 w-5 items-center justify-center rounded border-2 ${
                  rememberMe ? 'border-[#FF5C35] bg-[#FF5C35]' : 'border-[#344054]'
                }`}>
                {rememberMe && <ThemedText className="text-xs font-bold text-white">?</ThemedText>}
              </TouchableOpacity>
              <ThemedText className="text-sm">Remember me</ThemedText>
            </View>
            <ThemedText className="text-xs text-[#98A2B3]">
              By signing in, you agree to our <ThemedText className="font-semibold text-[#FF5C35]">Terms of Service</ThemedText>{' '}
              and <ThemedText className="font-semibold text-[#FF5C35]">Privacy Policy</ThemedText>
            </ThemedText>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            className={`mb-6 items-center rounded-lg bg-[#FF5C35] py-4 ${loading ? 'opacity-70' : ''}`}
            disabled={loading}
            onPress={handleLogin}>
            <ThemedText className="text-base font-bold text-white">{loading ? 'Signing in...' : 'Sign in'}</ThemedText>
          </TouchableOpacity>

          <View className="flex-row justify-center gap-1">
            <ThemedText className="text-sm text-[#98A2B3]">Don&apos;t have an account?</ThemedText>
            <TouchableOpacity onPress={() => router.push('/')}>
              <ThemedText className="text-sm font-bold text-[#FF5C35]">Sign up</ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedView>
      </ScrollView>
    </SafeAreaView>
  );
}
