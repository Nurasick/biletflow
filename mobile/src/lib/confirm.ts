import { Alert, Platform } from 'react-native';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Asks before a consequential action on every platform.
 *
 * react-native-web implements `Alert.alert` as a no-op, so on the web build the
 * confirm button would silently never run. The browser's own dialog is used there.
 */
export function confirmAction({ title, message, confirmLabel, cancelLabel, destructive = false, onConfirm }: ConfirmOptions): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
