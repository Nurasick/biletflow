import { type PropsWithChildren } from 'react';
import { ScrollView, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useI18n } from '@/i18n';

export function Screen({ title, children, onBack }: PropsWithChildren<{ title: string; onBack?: () => void }>) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <SafeAreaView className="flex-1 bg-[#101828]">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('Back')} onPress={onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/'))}>
          <Text className="text-[#FF5C35]">{t('Back')}</Text>
        </TouchableOpacity>
        <Text accessibilityRole="header" className="text-2xl font-bold text-white">{title}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

// Callers translate source labels explicitly; user names, event data and identifiers pass through unchanged.
export function Label({ children }: PropsWithChildren) {
  return <Text className="text-base text-white">{children}</Text>;
}

export function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className={`rounded-xl bg-[#FF5C35] p-4 ${disabled ? 'opacity-50' : ''}`}>
      <Text className="text-center font-bold text-white">{title}</Text>
    </TouchableOpacity>
  );
}
