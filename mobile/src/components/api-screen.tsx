import { type PropsWithChildren } from 'react';
import { ScrollView, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
export function Screen({ title, children, onBack }: PropsWithChildren<{
    title: string;
    onBack?: () => void;
}>) {
    const router = useRouter();
    return <SafeAreaView className="flex-1 bg-[#101828]"><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}><TouchableOpacity onPress={onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/'))}><Text className="text-[#FF5C35]">Back</Text></TouchableOpacity><Text className="text-2xl font-bold text-white">{title}</Text>{children}</ScrollView></SafeAreaView>;
}
export function Label({ children }: PropsWithChildren) { return <Text className="text-base text-white">{children}</Text>; }
export function Button({ title, onPress, disabled = false }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
}) { return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} className={`rounded-xl bg-[#FF5C35] p-4 ${disabled ? 'opacity-50' : ''}`}><Text className="text-center font-bold text-white">{title}</Text></TouchableOpacity>; }
