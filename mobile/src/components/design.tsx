import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { StyleSheet, Text as NativeText, View } from 'react-native';

import { Fonts, Stage } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function AppText({ style, ...props }: ComponentProps<typeof NativeText>) {
  const current = StyleSheet.flatten(style);
  const weight = current?.fontWeight === 'bold' ? 700 : Number(current?.fontWeight ?? 500);
  const fontFamily = weight >= 800 ? Fonts.display : weight >= 600 ? Fonts.bold : Fonts.sans;
  return <NativeText {...props} style={current?.fontFamily ? style : [style, { fontFamily, fontWeight: 'normal' }]} />;
}

const symbols = {
  arrowLeft: { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' },
  arrowRight: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  arrowUpRight: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  bell: { ios: 'bell', android: 'notifications', web: 'notifications' },
  calendar: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  circle: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  crossCircle: { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' },
  discoverFilled: { ios: 'safari.fill', android: 'explore', web: 'explore' },
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  eyeSlash: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' },
  menuLines: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' },
  signOut: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  ticketFilled: { ios: 'ticket.fill', android: 'confirmation_number', web: 'confirmation_number' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  discover: { ios: 'safari', android: 'explore', web: 'explore' },
  event: { ios: 'music.note', android: 'music_note', web: 'music_note' },
  help: { ios: 'questionmark.circle', android: 'help_outline', web: 'help_outline' },
  location: { ios: 'mappin', android: 'location_on', web: 'location_on' },
  menu: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner', web: 'qr_code_scanner' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  shield: { ios: 'shield', android: 'shield', web: 'shield' },
  ticket: { ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' },
  user: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
} as const satisfies Record<string, ComponentProps<typeof SymbolView>['name']>;

export type IconName = keyof typeof symbols;

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <View accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <SymbolView name={symbols[name]} tintColor={color} size={size} />
    </View>
  );
}

export function Wordmark({ onStage = false }: { onStage?: boolean }) {
  const colors = useTheme();
  return (
    <View style={styles.wordmark}>
      <View style={[styles.mark, { backgroundColor: onStage ? Stage.accent : colors.button }]}>
        <Icon name="ticket" size={22} color={onStage ? Stage.background : '#FFFFFF'} />
      </View>
      <AppText style={{ fontSize: 23, fontWeight: '800', letterSpacing: -1.25, color: onStage ? '#FFFFFF' : colors.text }}>BiletFlow</AppText>
    </View>
  );
}

export function TicketArtwork() {
  return (
    <View pointerEvents="none" accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.artwork}>
      <View style={styles.ticket}>
        <View style={styles.ticketFace}>
          <Icon name="ticket" size={25} color={Stage.background} />
          <AppText style={{ color: Stage.background, fontSize: 18, fontWeight: '800', letterSpacing: -0.8 }}>BiletFlow</AppText>
        </View>
        <View style={styles.ticketStub}><Icon name="scan" size={23} color={Stage.background} /></View>
        <View style={[styles.ticketNotch, { top: -5 }]} />
        <View style={[styles.ticketNotch, { bottom: -5 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  mark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  artwork: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 24 },
  ticket: { flexDirection: 'row', width: 165, height: 88, borderRadius: 12, backgroundColor: Stage.accent, transform: [{ rotate: '-10deg' }] },
  ticketFace: { width: 113, justifyContent: 'space-between', padding: 10 },
  ticketStub: { flex: 1, alignItems: 'center', justifyContent: 'center', borderLeftColor: '#615333', borderLeftWidth: 1, borderStyle: 'dashed' },
  ticketNotch: { position: 'absolute', left: 108, width: 10, height: 10, borderRadius: 5, backgroundColor: Stage.background },
});
