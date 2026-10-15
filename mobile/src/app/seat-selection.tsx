import { useState } from 'react';
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

type SeatType = 'standard' | 'premium' | 'vip';

const ROWS: { name: string; type: SeatType }[] = [
  { name: '1', type: 'standard' },
  { name: '2', type: 'standard' },
  { name: '3', type: 'standard' },
  { name: '4', type: 'premium' },
  { name: '5', type: 'premium' },
  { name: '6', type: 'vip' },
  { name: '7', type: 'vip' },
];
const SEATS_PER_ROW = 12;
const SOLD_SEATS = new Set(['2-5', '2-6', '5-7', '5-8', '7-4', '7-5', '7-6', '7-7', '7-8', '7-9']);
const INITIAL_SELECTION = ['3-6', '3-7'];
const SEAT_PRICE: Record<SeatType, number> = { standard: 8500, premium: 12000, vip: 15000 };
const COLORS: Record<SeatType, { border: string; background: string; text: string }> = {
  standard: { border: '#FF563D', background: '#111A2A', text: '#FF563D' },
  premium: { border: '#207C6C', background: '#123D3A', text: '#65C9AE' },
  vip: { border: '#B98220', background: '#3A301D', text: '#E7B547' },
};

export default function SeatSelectionScreen() {
  const router = useRouter();
  const [selectedSeats, setSelectedSeats] = useState<string[]>(INITIAL_SELECTION);

  const toggleSeat = (seat: string) => {
    if (SOLD_SEATS.has(seat)) return;
    setSelectedSeats((current) =>
      current.includes(seat) ? current.filter((item) => item !== seat) : [...current, seat],
    );
  };

  const selectedTotal = selectedSeats.reduce((sum, seat) => {
    const row = ROWS.find((item) => item.name === seat.split('-')[0]);
    return sum + (row ? SEAT_PRICE[row.type] : 0);
  }, 0);

  return (
    <SafeAreaView className="flex-1 bg-[#0F1728]" edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#172235" />

      <View className="h-14 flex-row items-center border-b border-[#344054] bg-[#172235] px-4">
        <TouchableOpacity
          accessibilityLabel="Go back to event details"
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#344054] bg-[#1D2939]"
          onPress={() => router.back()}>
          <Text className="text-lg text-[#D0D5DD]">←</Text>
        </TouchableOpacity>
        <Text className="flex-1 text-center text-[15px] font-bold text-white">Select seats</Text>
        <View className="w-[34px]" />
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 16 }}>
        <Text className="text-[17px] font-extrabold text-white">Almaty Indie Night</Text>
        <Text className="mt-1 text-[11px] text-[#98A2B3]">Sat 18 Apr · 19:00 · Main hall</Text>

        <View className="mt-6 h-[38px] justify-center rounded-b-[24px] bg-[#F5F5F0] px-6">
          <Text className="sr-only">Stage</Text>
        </View>

        <View className="mt-4">
          {ROWS.map((row) => (
            <View key={row.name} className="mb-1 flex-row items-center justify-between">
              <Text className="w-[12px] text-[9px] text-[#98A2B3]">{row.name}</Text>
              {Array.from({ length: SEATS_PER_ROW }, (_, index) => {
                const seat = `${row.name}-${index + 1}`;
                const sold = SOLD_SEATS.has(seat);
                const selected = selectedSeats.includes(seat);
                const palette = COLORS[row.type];
                return (
                  <TouchableOpacity
                    key={seat}
                    accessibilityRole="button"
                    accessibilityLabel={`Row ${row.name}, seat ${index + 1}, ${sold ? 'sold' : selected ? 'selected' : row.type}`}
                    accessibilityState={{ disabled: sold, selected }}
                    disabled={sold}
                    onPress={() => toggleSeat(seat)}
                    className="h-6 w-6 items-center justify-center rounded-[5px]"
                    style={{
                      backgroundColor: sold ? '#344054' : selected ? '#FF563D' : palette.background,
                      borderWidth: sold ? 0 : 1,
                      borderColor: selected || sold ? 'transparent' : palette.border,
                    }}>
                    <Text className="text-[9px] font-bold" style={{ color: sold ? '#98A2B3' : selected ? '#FFFFFF' : palette.text }}>
                      {sold ? '×' : selected ? '✓' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <Text className="w-[12px] text-right text-[9px] text-[#98A2B3]">{row.name}</Text>
            </View>
          ))}
        </View>

        <View className="mt-4 flex-row flex-wrap items-center gap-x-3 gap-y-2">
          <Legend color="#FF563D" label="Selected" filled />
          <Legend color={COLORS.standard.border} label="Standard" />
          <Legend color={COLORS.premium.border} label="Premium" filled />
          <Legend color={COLORS.vip.border} label="VIP" filled />
          <Legend color="#344054" label="Sold" filled />
        </View>

        <View className="mt-3 overflow-hidden rounded-xl border border-[#344054] bg-[#172235]">
          <View className="flex-row items-center justify-between border-b border-[#344054] px-3 py-3">
            <Text className="text-[12px] font-bold text-white">Selected seats ({selectedSeats.length})</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setSelectedSeats([])}>
              <Text className="text-[10px] font-bold text-[#FF563D]">Clear all</Text>
            </TouchableOpacity>
          </View>
          {selectedSeats.length === 0 ? (
            <Text className="px-3 py-4 text-[11px] text-[#98A2B3]">Choose seats from the map above.</Text>
          ) : selectedSeats.map((seat) => {
            const row = ROWS.find((item) => item.name === seat.split('-')[0]);
            const type = row?.type ?? 'standard';
            return (
              <View key={seat} className="flex-row items-center justify-between border-b border-[#344054] px-3 py-[9px] last:border-b-0">
                <View>
                  <Text className="text-[11px] font-bold text-[#F2F4F7]">Row {seat.split('-')[0]} · Seat {seat.split('-')[1]}</Text>
                  <Text className="mt-[2px] text-[9px] capitalize text-[#98A2B3]">{type}</Text>
                </View>
                <Text className="text-[11px] font-extrabold text-white">{SEAT_PRICE[type].toLocaleString('en-US').replaceAll(',', ' ')} ₸</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="flex-row items-center justify-between border-t border-[#344054] bg-[#172235] px-3 py-3">
        <View>
          <Text className="text-[10px] text-[#98A2B3]">Total</Text>
          <Text className="mt-[2px] text-[14px] font-extrabold text-white">{selectedTotal.toLocaleString('en-US').replaceAll(',', ' ')} ₸</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: selectedSeats.length === 0 }}
          disabled={selectedSeats.length === 0}
          className={`h-12 w-[150px] items-center justify-center rounded-xl ${selectedSeats.length ? 'bg-[#FF563D]' : 'bg-[#667085]'}`}>
          <Text className="text-[14px] font-extrabold text-[#101828]">Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Legend({ color, label, filled = false }: { color: string; label: string; filled?: boolean }) {
  return (
    <View className="flex-row items-center gap-1">
      <View className="h-[11px] w-[11px] rounded-[2px]" style={{ backgroundColor: filled ? color : 'transparent', borderWidth: filled ? 0 : 1, borderColor: color }} />
      <Text className="text-[9px] text-[#98A2B3]">{label}</Text>
    </View>
  );
}
