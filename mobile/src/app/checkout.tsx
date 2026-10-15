import { type ReactNode, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { EVENT, PROCESSING_FEE, formatTenge, getSeat, type Seat } from '@/constants/seating';

type PaymentMethod = 'card' | 'kaspi' | 'bank';

const PAYMENT_METHODS: { id: PaymentMethod; label: string; logos?: string }[] = [
  { id: 'card', label: 'Credit / debit card', logos: 'VISA · MC' },
  { id: 'kaspi', label: 'Kaspi / e-wallet', logos: 'KASPI' },
  { id: 'bank', label: 'Bank transfer' },
];

// Sandbox-only promo code; real codes must be validated by the backend when checkout is wired to the API.
const DEMO_PROMO_CODE = 'BILETFLOW10';
const DEMO_PROMO_RATE = 0.1;

export default function CheckoutScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const params = useLocalSearchParams<{ seats?: string }>();

  // Only seat IDs travel through the route; tier and price are looked up locally so they can't be edited via the URL.
  const seats = useMemo(
    () => [...new Set((params.seats ?? '').split(','))].map(getSeat).filter((seat): seat is Seat => seat !== null),
    [params.seats],
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const subtotal = seats.reduce((sum, seat) => sum + seat.price, 0);
  const discount = promoApplied ? Math.round(subtotal * DEMO_PROMO_RATE) : 0;
  const total = seats.length ? subtotal + PROCESSING_FEE - discount : 0;

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/seat-selection');
  };

  const handleApplyPromo = () => {
    const isValid = promoCode.trim().toUpperCase() === DEMO_PROMO_CODE;
    setPromoApplied(isValid);
    setPromoError(isValid ? null : 'This promo code is not valid.');
  };

  const finishCheckout = () => {
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace('/');
  };

  const handlePayment = () => {
    const message = 'Your sandbox checkout was successful!';
    // Alert buttons are not supported by react-native-web, so fall back to the browser dialog there.
    if (Platform.OS === 'web') {
      window.alert(`Order confirmed\n\n${message}`);
      finishCheckout();
      return;
    }

    Alert.alert('Order confirmed', message, [{ text: 'Back to home', onPress: finishCheckout }], { cancelable: false });
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F5F5F0] dark:bg-[#101828]" edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? '#182230' : '#FFFFFF'} />

      <View className="h-14 flex-row items-center border-b border-[#D0D5DD] bg-white px-4 dark:border-[#344054] dark:bg-[#182230]">
        <TouchableOpacity
          accessibilityLabel="Go back to seat selection"
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#D0D5DD] bg-[#F9FAF7] dark:border-[#344054] dark:bg-[#1D2939]"
          onPress={goBack}>
          <Text className="text-lg font-bold text-[#101828] dark:text-[#F5F5F0]">←</Text>
        </TouchableOpacity>
        <Text className="flex-1 text-center text-[15px] font-bold text-[#101828] dark:text-[#F5F5F0]">Checkout</Text>
        <View className="w-[34px]" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View className="mb-3 flex-row gap-[10px] rounded-xl border border-[#D0D5DD] bg-white p-3 dark:border-[#344054] dark:bg-[#182230]">
          <View className="h-[72px] w-[72px] items-center justify-center rounded-[10px] bg-[#3A2731]">
            <Text className="text-[25px] text-[#FF5C35]">♪</Text>
          </View>
          <View className="flex-1 justify-center">
            <Text className="mb-1 text-[13.5px] font-bold text-[#101828] dark:text-[#F5F5F0]">{EVENT.title}</Text>
            <Text className="my-[2px] text-[10px] text-[#667085] dark:text-[#98A2B3]">{EVENT.date} · {EVENT.time}</Text>
            <Text className="my-[2px] text-[10px] text-[#667085] dark:text-[#98A2B3]">{EVENT.venue} · {EVENT.hall}</Text>
          </View>
        </View>

        <Card title="Order summary">
          {seats.length === 0 ? (
            <Text className="py-3 text-[11px] text-[#667085] dark:text-[#98A2B3]">No seats selected. Go back and choose seats on the map.</Text>
          ) : seats.map((seat, index) => (
            <View
              key={seat.id}
              className={`flex-row justify-between gap-3 py-[9px] ${index < seats.length - 1 ? 'border-b border-[#D0D5DD] dark:border-[#344054]' : ''}`}>
              <View>
                <Text className="text-[11.5px] font-bold text-[#101828] dark:text-[#F5F5F0]">Row {seat.row} · Seat {seat.number}</Text>
                <Text className="mt-[3px] text-[9.5px] capitalize text-[#667085] dark:text-[#98A2B3]">{seat.type}</Text>
              </View>
              <Text className="text-[11.5px] text-[#101828] dark:text-[#F5F5F0]">{formatTenge(seat.price)}</Text>
            </View>
          ))}

          <View className="mt-1 border-t border-[#D0D5DD] pt-[6px] dark:border-[#344054]">
            <TotalLine label="Subtotal" amount={formatTenge(subtotal)} />
            <TotalLine label="Processing fee" amount={formatTenge(seats.length ? PROCESSING_FEE : 0)} />
            {discount > 0 && <TotalLine label={`Promo ${DEMO_PROMO_CODE}`} amount={`−${formatTenge(discount)}`} accent />}
            <View className="flex-row justify-between pt-2">
              <Text className="text-[15px] font-extrabold text-[#101828] dark:text-[#F5F5F0]">Total</Text>
              <Text className="text-[15px] font-extrabold text-[#101828] dark:text-[#F5F5F0]">{formatTenge(total)}</Text>
            </View>
          </View>
        </Card>

        <Card title="Payment method">
          {PAYMENT_METHODS.map((method, index) => {
            const selected = paymentMethod === method.id;
            return (
              <TouchableOpacity
                key={method.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setPaymentMethod(method.id)}
                className={`flex-row items-center gap-2 py-[10px] ${index < PAYMENT_METHODS.length - 1 ? 'border-b border-[#D0D5DD] dark:border-[#344054]' : ''}`}>
                <View
                  className={`h-[15px] w-[15px] items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-[#FF5C35]' : 'border-[#667085] dark:border-[#98A2B3]'}`}>
                  {selected && <View className="h-[7px] w-[7px] rounded-full bg-[#FF5C35]" />}
                </View>
                <Text className="text-[11px] text-[#101828] dark:text-[#F5F5F0]">{method.label}</Text>
                {method.logos && (
                  <Text className="ml-auto font-mono text-[8.5px] font-bold text-[#667085] dark:text-[#98A2B3]">{method.logos}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </Card>

        <View className="flex-row items-center gap-2 rounded-[11px] border border-[#D0D5DD] bg-white px-3 py-[6px] dark:border-[#344054] dark:bg-[#182230]">
          <TextInput
            value={promoCode}
            onChangeText={(value) => {
              setPromoCode(value);
              setPromoError(null);
            }}
            onSubmitEditing={handleApplyPromo}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            placeholder="Promo code"
            placeholderTextColor={isDark ? '#98A2B3' : '#667085'}
            className="h-8 min-w-0 flex-1 text-[12px] text-[#101828] dark:text-[#F5F5F0]"
          />
          <TouchableOpacity accessibilityRole="button" disabled={!promoCode.trim()} onPress={handleApplyPromo}>
            <Text className={`text-[12px] font-extrabold ${promoCode.trim() ? 'text-[#FF5C35]' : 'text-[#98A2B3]'}`}>Apply</Text>
          </TouchableOpacity>
        </View>
        {promoError && <Text className="mx-[2px] mt-[6px] text-[10px] text-[#F04438]">{promoError}</Text>}
        {promoApplied && <Text className="mx-[2px] mt-[6px] text-[10px] text-[#FF5C35]">Promo code applied: 10% off seats.</Text>}

        <Text className="mx-[2px] mt-[10px] text-[9.5px] leading-[14px] text-[#667085] dark:text-[#98A2B3]">
          Tickets are issued only after payment confirmation. Abandoned checkouts release reserved seats automatically.
        </Text>
      </ScrollView>

      <View className="border-t border-[#D0D5DD] bg-white px-[14px] py-3 dark:border-[#344054] dark:bg-[#182230]">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: seats.length === 0 }}
          disabled={seats.length === 0}
          onPress={handlePayment}
          className={`h-12 items-center justify-center rounded-xl ${seats.length ? 'bg-[#FF5C35]' : 'bg-[#98A2B3] dark:bg-[#667085]'}`}>
          <Text className="text-sm font-extrabold text-[#101828]">Pay {formatTenge(total)}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mb-3 rounded-xl border border-[#D0D5DD] bg-white p-[13px] dark:border-[#344054] dark:bg-[#182230]">
      <Text className="mb-[6px] text-[13.5px] font-bold text-[#101828] dark:text-[#F5F5F0]">{title}</Text>
      {children}
    </View>
  );
}

function TotalLine({ label, amount, accent = false }: { label: string; amount: string; accent?: boolean }) {
  const color = accent ? 'text-[#FF5C35]' : 'text-[#667085] dark:text-[#98A2B3]';
  return (
    <View className="flex-row justify-between py-1">
      <Text className={`text-[11.5px] ${color}`}>{label}</Text>
      <Text className={`text-[11.5px] ${color}`}>{amount}</Text>
    </View>
  );
}
