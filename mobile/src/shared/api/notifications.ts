import type { AuthenticatedFetch } from './orders';

export type NotificationItem = {
  id: number; template_key: string; payload: Record<string, unknown>;
  read_at: string | null; created_at: string;
};
export type NotificationFeed = { unread: number; items: NotificationItem[] };

export const notificationTitles: Record<string, string> = {
  'order.confirmed': 'Order confirmed', 'payment.failed': 'Payment failed',
  'order.cancelled': 'Order cancelled', 'refund.completed': 'Refund completed',
  'event.updated': 'Event updated', 'event.cancelled': 'Event cancelled',
  'payout.status': 'Paid sales status', 'support.message': 'New support reply',
  'support.assigned': 'Support case assigned', 'support.status': 'Support status changed',
};

export const notificationsApi = {
  async list(fetcher: AuthenticatedFetch, signal?: AbortSignal): Promise<NotificationFeed> {
    const response = await fetcher('/users/me/notifications', { signal });
    if (!response.ok) throw new Error('Could not load notifications.');
    return response.json();
  },
  async markRead(fetcher: AuthenticatedFetch): Promise<void> {
    const response = await fetcher('/users/me/notifications/read', { method: 'POST' });
    if (!response.ok) throw new Error('Could not mark notifications as read.');
  },
};
