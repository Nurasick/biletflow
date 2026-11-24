import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/design';
import { ThemedText } from '@/components/themed-text';
import { Action, WorkspaceScreen } from '@/components/workspace';
import { useI18n } from '@/i18n';
import { TicketQr } from '@/components/ticket-qr';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import type { AppColors } from '@/constants/theme';
import { downloadOrderTicketsPdf, openEventCalendar } from '@/shared/api/documents';
import { formatEventDate } from '@/shared/api/events';
import { formatOrderMoney, ordersApi, type Order, type OrderStatus } from '@/shared/api/orders';
import { confirmAction } from '@/lib/confirm';

export default function TicketsScreen() {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const { authenticatedFetch } = useAuth();
  const colors = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [documentBusy, setDocumentBusy] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

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
    confirmAction({
      title: t('Cancel order?'),
      message: t('Cancel this pending order and release its ticket reservation?'),
      confirmLabel: t('Cancel order'),
      cancelLabel: t('Keep order'),
      destructive: true,
      onConfirm: () => void runOrderAction(order, 'cancel'),
    });
  };

  const refresh = () => void loadOrders();

  const savePdf = async (order: Order) => {
    setDocumentBusy(order.order_number);
    setDocumentError(null);
    try {
      await downloadOrderTicketsPdf(authenticatedFetch, order.order_number);
    } catch (failure) {
      setDocumentError(failure instanceof Error ? failure.message : 'Could not download ticket PDF.');
    } finally {
      setDocumentBusy(null);
    }
  };

  const addToCalendar = async (order: Order) => {
    setDocumentError(null);
    try {
      await openEventCalendar(order.event.slug);
    } catch (failure) {
      setDocumentError(failure instanceof Error ? failure.message : 'Could not open the calendar file.');
    }
  };

  return (
    <WorkspaceScreen tab="tickets" title={t('My tickets')} onRefresh={refresh} refreshing={isLoading && orders.length > 0}>
        <ThemedText style={{ color: colors.muted, fontSize: 14 }}>{t("Tickets and order status for your account.")}</ThemedText>

        {isLoading && orders.length === 0 && <View style={{ alignItems: 'center', paddingVertical: 48 }}><ActivityIndicator color={colors.accent} /><ThemedText style={{ marginTop: 12, color: colors.muted }}>{t("Loading your orders…")}</ThemedText></View>}

        {error && <FeedbackCard message={error} colors={colors} buttonLabel={t("Try again")} onPress={refresh} />}

        {!isLoading && !error && orders.length === 0 && (
          <View style={{ alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.accentWash }}><Icon name="ticket" color={colors.accent} size={26} /></View>
            <ThemedText style={{ marginTop: 13, color: colors.text, fontSize: 16, fontWeight: '800' }}>{t("No orders yet")}</ThemedText>
            <ThemedText style={{ marginTop: 5, color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 }}>{t("When you register for an event or buy a ticket, your order and tickets will appear here.")}</ThemedText>
            <View style={{ marginTop: 16 }}><Action label={t('Browse events')} onPress={() => router.navigate('/')} /></View>
          </View>
        )}

        {!error && orders.map((order) => {
          const expanded = openOrder === order.order_number;
          const isBusy = busyOrder === order.order_number;
          return (
            <View key={order.order_number} style={{ overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpenOrder(expanded ? null : order.order_number)} style={({ pressed }) => ({ padding: 16, backgroundColor: pressed ? colors.raised : colors.surface })}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{order.event.title}</ThemedText>
                    <ThemedText style={{ marginTop: 5, color: colors.muted, fontSize: 11 }}>{formatDate(order.event.starts_at, order.event.timezone)}</ThemedText>
                    <ThemedText numberOfLines={1} style={{ marginTop: 3, color: colors.muted, fontSize: 11 }}>{order.event.venue_name}</ThemedText>
                  </View>
                  <StatusBadge status={order.status} colors={colors} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <ThemedText style={{ color: colors.muted, fontSize: 11 }}>{t("Order")} {order.order_number}</ThemedText>
                  <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{formatOrderMoney(order.total_minor, order.currency)}</ThemedText>
                </View>
                <ThemedText style={{ marginTop: 8, color: colors.accent, fontSize: 13, fontWeight: '700' }}>{expanded ? t("Hide details  ↑") : t('View details')}</ThemedText>
              </Pressable>

              {expanded && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/support-new', params: { eventId: String(order.event_id), orderNumber: order.order_number } })} style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
                    <ThemedText style={{ color: colors.accent, fontWeight: '700' }}>{t('Order support')}</ThemedText>
                  </Pressable>
                  <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <ThemedText style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{t("Order summary")}</ThemedText>
                    {order.items.map((item) => <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}><ThemedText style={{ color: colors.muted, fontSize: 11 }}>{item.quantity} {t("× ticket")}</ThemedText><ThemedText style={{ color: colors.text, fontSize: 11 }}>{formatOrderMoney(item.subtotal_minor, order.currency)}</ThemedText></View>)}
                    {order.fee_minor > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}><ThemedText style={{ color: colors.muted, fontSize: 11 }}>{t("Processing fee")}</ThemedText><ThemedText style={{ color: colors.text, fontSize: 11 }}>{formatOrderMoney(order.fee_minor, order.currency)}</ThemedText></View>}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 9, marginTop: 13 }}>
                    {order.tickets.some((ticket) => ticket.status === 'valid' || ticket.status === 'checked_in') && (
                      <ActionButton label={documentBusy === order.order_number ? t("Preparing PDF…") : t("Download tickets PDF")} disabled={documentBusy !== null} colors={colors} onPress={() => void savePdf(order)} />
                    )}
                    <ActionButton label={t("Add to calendar")} disabled={documentBusy !== null} secondary colors={colors} onPress={() => void addToCalendar(order)} />
                  </View>
                  {documentError && <ThemedText style={{ marginTop: 8, color: colors.danger, fontSize: 12 }}>{t(documentError)}</ThemedText>}

                  {order.status === 'pending' && (
                    <View style={{ flexDirection: 'row', gap: 9, marginTop: 13 }}>
                      <ActionButton label={isBusy ? t("Working…") : t("Pay (demo)")} disabled={isBusy} colors={colors} onPress={() => void runOrderAction(order, 'pay')} />
                      <ActionButton label={isBusy ? t("Working…") : t("Cancel")} disabled={isBusy} secondary colors={colors} onPress={() => confirmCancel(order)} />
                    </View>
                  )}

                  {actionError && busyOrder === null && <ThemedText style={{ marginTop: 10, color: colors.danger, fontSize: 12 }}>{t(actionError)}</ThemedText>}
                  {order.status === 'pending' && <ThemedText style={{ marginTop: 9, color: colors.muted, fontSize: 10 }}>{t("Demo payment only. No real payment is made.")}</ThemedText>}

                  <View style={{ marginTop: 15 }}>
                    <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t("Tickets (")}{order.tickets.length})</ThemedText>
                    {order.tickets.length === 0 ? (
                      <ThemedText style={{ marginTop: 7, color: colors.muted, fontSize: 11 }}>{order.status === 'pending' ? t("Tickets are issued after successful payment.") : t("This order has no tickets.")}</ThemedText>
                    ) : order.tickets.map((ticket) => <TicketCard key={ticket.public_code} ticket={ticket} order={order} colors={colors} />)}
                  </View>
                </View>
              )}
            </View>
          );
        })}
    </WorkspaceScreen>
  );
}

function StatusBadge({ status, colors }: { status: OrderStatus; colors: AppColors }) {
  const { t } = useI18n();
  const color = status === 'confirmed' ? colors.success : status === 'pending' ? colors.warning : colors.muted;
  const label = t(status);
  const backgroundColor = status === 'confirmed' ? colors.successWash : status === 'pending' ? colors.warningWash : colors.raised;
  return <View style={{ maxWidth: '51%', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 15, backgroundColor }}><ThemedText style={{ color, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }}>{label}</ThemedText></View>;
}

function TicketCard({ ticket, order, colors }: { ticket: Order['tickets'][number]; order: Order; colors: AppColors }) {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const statusColor = ticket.status === 'valid' ? colors.success : ticket.status === 'checked_in' ? colors.warning : colors.muted;
  const canScan = (ticket.status === 'valid' || ticket.status === 'checked_in') && ticket.qr_payload.length > 0;
  return (
    <View style={{ alignItems: 'center', marginTop: 10, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
      <View style={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{ticket.ticket_type_name}</ThemedText>
          <ThemedText style={{ marginTop: 4, color: colors.muted, fontSize: 11 }}>{t("For")} {ticket.attendee_name}</ThemedText>
        </View>
        <ThemedText style={{ color: statusColor, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }}>{t(ticket.status)}</ThemedText>
      </View>
      <ThemedText style={{ alignSelf: 'flex-start', marginTop: 10, color: colors.muted, fontSize: 10 }}>{t("Ticket code ·")} {ticket.public_code}</ThemedText>
      {canScan ? <View style={{ marginTop: 13, overflow: 'hidden', borderRadius: 5 }}><TicketQr payload={ticket.qr_payload} /></View> : <ThemedText style={{ marginTop: 13, color: colors.muted, fontSize: 11 }}>{t("This ticket is no longer valid for entry.")}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/support-new', params: { eventId: String(order.event_id), orderNumber: order.order_number, ticketCode: ticket.public_code } })} style={{ marginTop: 12, minHeight: 44, justifyContent: 'center' }}>
        <ThemedText style={{ color: colors.accent, fontWeight: '700' }}>{t('Ticket support')}</ThemedText>
      </Pressable>
      <ThemedText style={{ marginTop: 12, color: colors.text, textAlign: 'center', fontSize: 12, fontWeight: '700' }}>{order.event.title}</ThemedText>
      <ThemedText style={{ marginTop: 4, color: colors.muted, textAlign: 'center', fontSize: 10 }}>{formatDate(order.event.starts_at, order.event.timezone)} · {order.event.venue_name}</ThemedText>
    </View>
  );
}

function FeedbackCard({ message, colors, buttonLabel, onPress }: { message: string; colors: AppColors; buttonLabel: string; onPress: () => void }) {
  const { t, formatDate } = useI18n();
  return <View style={{ alignItems: 'center', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}><ThemedText style={{ color: colors.text, textAlign: 'center', fontSize: 13 }}>{message}</ThemedText><Pressable onPress={onPress} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.accent }}><ThemedText style={{ color: '#FFFFFF', fontWeight: '800' }}>{t(buttonLabel)}</ThemedText></Pressable></View>;
}

function ActionButton({ label, disabled, secondary = false, onPress }: { label: string; disabled: boolean; secondary?: boolean; colors: AppColors; onPress: () => void }) {
  return <View style={{ flex: 1 }}><Action label={label} disabled={disabled} secondary={secondary} onPress={onPress} /></View>;
}
