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
  const [rememberMe, setRememberMe] = useState(false);
  const { login, loading, error } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) {
      return;
    }
    await login(email, password);
    router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <StatusBar barStyle="light-content" backgroundColor="#101828" />

      {/* Decorative blob */}
      <View className="absolute top-0 right-0 w-64 h-64 bg-orange-500 rounded-full opacity-10 blur-3xl" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <ThemedView className="flex-1 justify-center px-6 relative z-10">
          {/* Logo */}
          <View className="flex-row items-center gap-2 mb-12">
            <View className="w-6 h-7 bg-orange-500 rounded" />
            <ThemedText className="text-2xl font-extrabold">
              Bilet<ThemedText className="text-orange-500">Flow</ThemedText>
            </ThemedText>
          </View>

          {/* Copy Section */}
          <View className="mb-7">
            <ThemedText className="text-xs font-bold text-orange-500 mb-2 tracking-widest">
              WELCOME BACK
            </ThemedText>
            <ThemedText className="text-3xl font-bold leading-tight mb-2">
              Your next great{'\n'}night starts here.
            </ThemedText>
            <ThemedText className="text-sm text-gray-400">
              Sign in to access your tickets, saved events and faster checkout.
            </ThemedText>
          </View>

          {/* Error Message */}
          {error && (
            <ThemedText className="text-red-500 text-sm mb-4 bg-red-900/20 px-3 py-2 rounded">
              {error}
            </ThemedText>
          )}

          {/* Email Input */}
          <View className="mb-4">
            <ThemedText className="text-sm font-semibold mb-2">Email address</ThemedText>
            <TextInput
              placeholder="you@example.com"
              placeholderTextColor="#98A2B3"
              style={{ color: '#F5F5F0' }}
              className="bg-slate-800 rounded-lg px-4 py-3 text-base border border-slate-700"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
            />
          </View>

          {/* Password Input */}
          <View className="mb-6">
            <View className="flex-row justify-between items-center mb-2">
              <ThemedText className="text-sm font-semibold">Password</ThemedText>
              <TouchableOpacity>
                <ThemedText className="text-xs text-orange-500 font-semibold">
                  Forgot password?
                </ThemedText>
              </TouchableOpacity>
            </View>
            <View className="flex-row items-center bg-slate-800 rounded-lg border border-slate-700">
              <TextInput
                placeholder="••••••••"
                placeholderTextColor="#98A2B3"
                style={{ color: '#F5F5F0', flex: 1 }}
                className="px-4 py-3 text-base"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                className="px-4"
              >
                <ThemedText className="text-lg">
                  {showPassword ? '◐' : '◉'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Remember & Agree Section */}
          <View className="mb-6 gap-3">
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => setRememberMe(!rememberMe)}
                className={`w-5 h-5 rounded border-2 items-center justify-center ${
                  rememberMe ? 'bg-orange-500 border-orange-500' : 'border-slate-600'
                }`}
              >
                {rememberMe && <ThemedText className="text-xs font-bold text-black">✓</ThemedText>}
              </TouchableOpacity>
              <ThemedText className="text-sm">Remember me</ThemedText>
            </View>
            <ThemedText className="text-xs text-gray-400">
              By signing in, you agree to our{' '}
              <ThemedText className="text-orange-500 font-semibold">Terms of Service</ThemedText>
              {' '}and{' '}
              <ThemedText className="text-orange-500 font-semibold">Privacy Policy</ThemedText>
            </ThemedText>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            className={`bg-orange-500 rounded-lg py-4 items-center mb-6 ${
              loading ? 'opacity-70' : ''
            }`}
            onPress={handleLogin}
            disabled={loading}
          >
            <ThemedText className="text-black font-bold text-base">
              {loading ? 'Signing in...' : 'Sign in'}
            </ThemedText>
          </TouchableOpacity>

          {/* Sign Up Link */}
          <View className="flex-row justify-center gap-1">
            <ThemedText className="text-sm text-gray-400">Don't have an account?</ThemedText>
            <TouchableOpacity onPress={() => router.push('/')}>
              <ThemedText className="text-sm text-orange-500 font-bold">Sign up</ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedView>
      </ScrollView>
    </SafeAreaView>
  );
}
