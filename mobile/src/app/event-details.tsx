import { ScrollView, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

const TICKETS = [
  { name: 'Standard', detail: 'Sections A–C · 340 left', price: '8 500 ₸' },
  { name: 'Student', detail: 'ID required · 60 left', price: '5 000 ₸' },
  { name: 'VIP', detail: 'Front rows + lounge · 12 left', price: '22 000 ₸' },
];

export default function EventDetailsScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F5F5F0] dark:bg-[#101828]" edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={isDark ? '#182230' : '#FFFFFF'}
      />

      <View className="h-14 flex-row items-center border-b border-[#D0D5DD] bg-white px-4 dark:border-[#344054] dark:bg-[#182230]">
        <TouchableOpacity
          accessibilityLabel="Go back"
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#D0D5DD] bg-[#F9FAF7] dark:border-[#344054] dark:bg-[#1D2939]"
          onPress={goBack}>
          <Text className="text-lg font-bold text-[#101828] dark:text-[#F5F5F0]">←</Text>
        </TouchableOpacity>
        <Text className="flex-1 text-center text-[15px] font-bold text-[#101828] dark:text-[#F5F5F0]">Event</Text>
        <TouchableOpacity
          accessibilityLabel="Share event"
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#D0D5DD] bg-[#F9FAF7] dark:border-[#344054] dark:bg-[#1D2939]">
          <Text className="text-base font-bold text-[#101828] dark:text-[#F5F5F0]">↗</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="h-[220px] justify-end overflow-hidden bg-[#3A2731] px-[18px] pb-[18px]">
          <View className="absolute -right-8 top-3 h-44 w-44 rounded-full bg-[#FF5C35] opacity-25" />
          <View className="absolute -right-1 top-8 h-32 w-32 rounded-full border-[18px] border-[#101828] opacity-40" />
          <Text className="mb-1 text-[10px] font-bold tracking-[1px] text-[#FFA38B]">CONCERT · 16+</Text>
          <Text className="text-[27px] font-extrabold leading-[29px] tracking-[-1.1px] text-white">Almaty Indie Night</Text>
          <Text className="mt-1 text-[13px] text-[#F2F4F7]">Spring Edition</Text>
        </View>

        <View className="-mt-[10px] mx-[14px] rounded-[14px] border border-[#D0D5DD] bg-white p-[15px] shadow-sm dark:border-[#344054] dark:bg-[#182230]">
          <InfoRow icon="◷" title="Sat, 18 Apr 2026 · 19:00" detail="Doors open 18:00" />
          <InfoRow icon="⌖" title="Palace of Republic" detail="Dostyk Ave 56, Almaty" />
          <View className="mt-[10px] flex-row flex-wrap gap-[7px]">
            <Chip label="Live music" />
            <Chip label="Assigned seating" />
            <Chip label="120 min" />
          </View>
        </View>

        <View className="px-4 pb-6 pt-5">
          <Text className="mb-3 text-[17px] font-extrabold tracking-[-0.3px] text-[#101828] dark:text-[#F5F5F0]">About the event</Text>
          <Text className="text-[12.5px] leading-5 text-[#667085] dark:text-[#98A2B3]">
            A packed spring showcase featuring local indie acts, guest performers and a late-night finale in the main hall.
          </Text>

          <Text className="mb-[10px] mt-5 text-[17px] font-extrabold tracking-[-0.3px] text-[#101828] dark:text-[#F5F5F0]">Tickets</Text>
          {TICKETS.map((ticket) => (
            <View
              className="mb-[10px] flex-row items-center justify-between rounded-xl border border-[#D0D5DD] bg-white px-3 py-[12px] dark:border-[#344054] dark:bg-[#182230]"
              key={ticket.name}>
              <View>
                <Text className="text-[13px] font-bold text-[#101828] dark:text-[#F5F5F0]">{ticket.name}</Text>
                <Text className="mt-[2px] text-[10.5px] text-[#667085] dark:text-[#98A2B3]">{ticket.detail}</Text>
              </View>
              <Text className="text-[13px] font-extrabold text-[#101828] dark:text-[#F5F5F0]">{ticket.price}</Text>
            </View>
          ))}

          <Text className="mb-3 mt-5 text-[17px] font-extrabold tracking-[-0.3px] text-[#101828] dark:text-[#F5F5F0]">Refunds</Text>
          <Text className="text-[12.5px] leading-5 text-[#667085] dark:text-[#98A2B3]">
            Full refund until 11 Apr. After that date, ticket refunds follow the organizer&apos;s published policy.
          </Text>
        </View>
      </ScrollView>

      <View className="border-t border-[#D0D5DD] bg-white px-[14px] pb-3 pt-3 dark:border-[#344054] dark:bg-[#182230]">
        <TouchableOpacity className="h-12 items-center justify-center rounded-xl bg-[#FF5C35]" onPress={() => {}}>
          <Text className="text-sm font-extrabold text-white">Select seats</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function InfoRow({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <View className="flex-row py-2">
      <Text className="w-[22px] text-[15px] font-bold text-[#FF5C35]">{icon}</Text>
      <Text className="flex-1 text-[12.5px] leading-[18px] text-[#101828] dark:text-[#F5F5F0]">
        <Text className="font-bold">{title}</Text>
        {`\n`}
        <Text className="text-[#667085] dark:text-[#98A2B3]">{detail}</Text>
      </Text>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-[#D0D5DD] bg-[#F9FAF7] px-[9px] py-[6px] dark:border-[#344054] dark:bg-[#101828]">
      <Text className="text-[10.5px] text-[#667085] dark:text-[#98A2B3]">{label}</Text>
    </View>
  );
}
