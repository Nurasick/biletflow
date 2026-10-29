import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TicketQr } from '@/components/ticket-qr';
import { useAuth } from '@/hooks/use-auth';
import { formatEventDate } from '@/shared/api/events';
import { formatOrderMoney, ordersApi, type Order, type OrderStatus } from '@/shared/api/orders';

const palette = {
  dark: { background: '#101828', surface: '#182230', raised: '#1D2939', border: '#344054', text: '#F5F5F0', muted: '#98A2B3', accent: '#FF5C35', success: '#12B76A', warning: '#F79009', danger: '#F97066' },
  light: { background: '#F5F5F0', surface: '#FFFFFF', raised: '#F9FAF7', border: '#D0D5DD', text: '#101828', muted: '#667085', accent: '#D9431F', success: '#039855', warning: '#DC6803', danger: '#D92D20' },
};

export default function TicketsScreen() {
  const router = useRouter();
  const { authenticatedFetch } = useAuth();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? palette.dark : palette.light;
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await ordersApi.mine(authenticatedFetch, signal);
      if (!signal?.aborted) setOrders(result);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') return;
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : 'Could not load your orders.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [authenticatedFetch]);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void loadOrders(controller.signal);
    return () => controller.abort();
  }, [loadOrders]));

  const runOrderAction = async (order: Order, action: 'pay' | 'cancel') => {
    setBusyOrder(order.order_number);
    setActionError(null);
    try {
      const updated = action === 'pay'
        ? await ordersApi.pay(authenticatedFetch, order.order_number)
        : await ordersApi.cancel(authenticatedFetch, order.order_number);
      setOrders((current) => current.map((item) => item.order_number === updated.order_number ? updated : item));
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'The order could not be updated.');
    } finally {
      setBusyOrder(null);
    }
  };

  const confirmCancel = (order: Order) => {
    const message = 'Cancel this pending order and release its ticket reservation?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) void runOrderAction(order, 'cancel');
      return;
    }
    Alert.alert('Cancel order?', message, [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => void runOrderAction(order, 'cancel') },
    ]);
  };

  const refresh = () => void loadOrders();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable accessibilityLabel="Back to events" onPress={() => router.back()} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
          <ThemedText style={{ color: colors.text, fontSize: 19 }}>‹</ThemedText>
        </Pressable>
        <ThemedText style={{ flex: 1, color: colors.text, textAlign: 'center', fontSize: 15, fontWeight: '800' }}>My tickets</ThemedText>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 17, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isLoading && orders.length > 0} onRefresh={refresh} tintColor={colors.accent} />}>
        <ThemedText style={{ color: colors.text, fontSize: 23, fontWeight: '900' }}>Your orders</ThemedText>
        <ThemedText style={{ marginTop: 4, marginBottom: 16, color: colors.muted, fontSize: 12 }}>Tickets and order status for your account.</ThemedText>

        {isLoading && orders.length === 0 && <View style={{ alignItems: 'center', paddingVertical: 48 }}><ActivityIndicator color={colors.accent} /><ThemedText style={{ marginTop: 12, color: colors.muted }}>Loading your orders…</ThemedText></View>}

        {error && <FeedbackCard message={error} colors={colors} buttonLabel="Try again" onPress={refresh} />}

        {!isLoading && !error && orders.length === 0 && (
          <View style={{ alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.raised }}><ThemedText style={{ color: colors.accent, fontSize: 27 }}>▣</ThemedText></View>
            <ThemedText style={{ marginTop: 13, color: colors.text, fontSize: 16, fontWeight: '800' }}>No orders yet</ThemedText>
            <ThemedText style={{ marginTop: 5, color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 }}>When you register for an event or buy a ticket, your order and tickets will appear here.</ThemedText>
            <Pressable onPress={() => router.replace('/')} style={{ marginTop: 16, paddingHorizontal: 17, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent }}><ThemedText style={{ color: '#FFFFFF', fontWeight: '800' }}>Browse events</ThemedText></Pressable>
          </View>
        )}

        {orders.map((order) => {
          const expanded = openOrder === order.order_number;
          const isBusy = busyOrder === order.order_number;
          return (
            <View key={order.order_number} style={{ marginBottom: 12, overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpenOrder(expanded ? null : order.order_number)} style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText numberOfLines={2} style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{order.event.title}</ThemedText>
                    <ThemedText style={{ marginTop: 5, color: colors.muted, fontSize: 11 }}>{formatEventDate(order.event.starts_at)}</ThemedText>
                    <ThemedText numberOfLines={1} style={{ marginTop: 3, color: colors.muted, fontSize: 11 }}>{order.event.venue_name}</ThemedText>
                  </View>
                  <StatusBadge status={order.status} colors={colors} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <ThemedText style={{ color: colors.muted, fontSize: 11 }}>Order {order.order_number}</ThemedText>
                  <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{formatOrderMoney(order.total_minor, order.currency)}</ThemedText>
                </View>
                <ThemedText style={{ marginTop: 8, color: colors.accent, fontSize: 11, fontWeight: '700' }}>{expanded ? 'Hide details  ↑' : `View details${order.tickets.length ? ` · ${order.tickets.length} tickets` : ''}  ↓`}</ThemedText>
              </Pressable>

              {expanded && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <ThemedText style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>Order summary</ThemedText>
                    {order.items.map((item) => <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}><ThemedText style={{ color: colors.muted, fontSize: 11 }}>{item.quantity} × ticket</ThemedText><ThemedText style={{ color: colors.text, fontSize: 11 }}>{formatOrderMoney(item.subtotal_minor, order.currency)}</ThemedText></View>)}
                    {order.fee_minor > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}><ThemedText style={{ color: colors.muted, fontSize: 11 }}>Processing fee</ThemedText><ThemedText style={{ color: colors.text, fontSize: 11 }}>{formatOrderMoney(order.fee_minor, order.currency)}</ThemedText></View>}
                  </View>

                  {order.status === 'pending' && (
                    <View style={{ flexDirection: 'row', gap: 9, marginTop: 13 }}>
                      <ActionButton label={isBusy ? 'Working…' : 'Pay (demo)'} disabled={isBusy} colors={colors} onPress={() => void runOrderAction(order, 'pay')} />
                      <ActionButton label={isBusy ? 'Working…' : 'Cancel'} disabled={isBusy} secondary colors={colors} onPress={() => confirmCancel(order)} />
                    </View>
                  )}

                  {actionError && busyOrder === null && <ThemedText style={{ marginTop: 10, color: colors.danger, fontSize: 12 }}>{actionError}</ThemedText>}
                  {order.status === 'pending' && <ThemedText style={{ marginTop: 9, color: colors.muted, fontSize: 10 }}>Demo payment only. No real payment is made.</ThemedText>}

                  <View style={{ marginTop: 15 }}>
                    <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>Tickets ({order.tickets.length})</ThemedText>
                    {order.tickets.length === 0 ? (
                      <ThemedText style={{ marginTop: 7, color: colors.muted, fontSize: 11 }}>{order.status === 'pending' ? 'Tickets are issued after successful payment.' : 'This order has no tickets.'}</ThemedText>
                    ) : order.tickets.map((ticket) => <TicketCard key={ticket.public_code} ticket={ticket} order={order} colors={colors} />)}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBadge({ status, colors }: { status: OrderStatus; colors: typeof palette.dark }) {
  const color = status === 'confirmed' ? colors.success : status === 'pending' ? colors.warning : colors.muted;
  const label = status.replace('_', ' ');
  return <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 15, backgroundColor: `${color}20` }}><ThemedText style={{ color, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }}>{label}</ThemedText></View>;
}

function TicketCard({ ticket, order, colors }: { ticket: Order['tickets'][number]; order: Order; colors: typeof palette.dark }) {
  const statusColor = ticket.status === 'valid' ? colors.success : ticket.status === 'checked_in' ? colors.warning : colors.muted;
  const canScan = (ticket.status === 'valid' || ticket.status === 'checked_in') && ticket.qr_payload.length > 0;
  return (
    <View style={{ alignItems: 'center', marginTop: 10, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
      <View style={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{ticket.ticket_type_name}</ThemedText>
          <ThemedText style={{ marginTop: 4, color: colors.muted, fontSize: 11 }}>For {ticket.attendee_name}</ThemedText>
        </View>
        <ThemedText style={{ color: statusColor, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }}>{ticket.status.replace('_', ' ')}</ThemedText>
      </View>
      <ThemedText style={{ alignSelf: 'flex-start', marginTop: 10, color: colors.muted, fontSize: 10 }}>Ticket code · {ticket.public_code}</ThemedText>
      {canScan ? <View style={{ marginTop: 13, overflow: 'hidden', borderRadius: 5 }}><TicketQr payload={ticket.qr_payload} /></View> : <ThemedText style={{ marginTop: 13, color: colors.muted, fontSize: 11 }}>This ticket is no longer valid for entry.</ThemedText>}
      <ThemedText style={{ marginTop: 12, color: colors.text, textAlign: 'center', fontSize: 12, fontWeight: '700' }}>{order.event.title}</ThemedText>
      <ThemedText style={{ marginTop: 4, color: colors.muted, textAlign: 'center', fontSize: 10 }}>{formatEventDate(order.event.starts_at)} · {order.event.venue_name}</ThemedText>
    </View>
  );
}

function FeedbackCard({ message, colors, buttonLabel, onPress }: { message: string; colors: typeof palette.dark; buttonLabel: string; onPress: () => void }) {
  return <View style={{ alignItems: 'center', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}><ThemedText style={{ color: colors.text, textAlign: 'center', fontSize: 13 }}>{message}</ThemedText><Pressable onPress={onPress} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.accent }}><ThemedText style={{ color: '#FFFFFF', fontWeight: '800' }}>{buttonLabel}</ThemedText></Pressable></View>;
}

function ActionButton({ label, disabled, secondary = false, colors, onPress }: { label: string; disabled: boolean; secondary?: boolean; colors: typeof palette.dark; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: secondary ? 1 : 0, borderColor: colors.border, backgroundColor: secondary ? colors.surface : colors.accent, opacity: disabled ? 0.55 : 1 }}><ThemedText style={{ color: secondary ? colors.text : '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{label}</ThemedText></Pressable>;
}
