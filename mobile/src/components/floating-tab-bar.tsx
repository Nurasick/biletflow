import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import type { Tabs } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View, useColorScheme, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, type IconName } from '@/components/design';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const BAR_HEIGHT = 64;
const BAR_PADDING = 6;
const BAR_MAX_WIDTH = 420;
const SIDE_MARGIN = 20;
const MIN_BOTTOM_GAP = 12;
const INDICATOR_MS = 240;

const tabs: Record<string, { label: string; icon: IconName; selectedIcon: IconName }> = {
  index: { label: 'Events', icon: 'discover', selectedIcon: 'discoverFilled' },
  tickets: { label: 'My tickets', icon: 'ticket', selectedIcon: 'ticketFilled' },
  workspace: { label: 'Menu', icon: 'menuLines', selectedIcon: 'menuLines' },
};

/** Distance from the screen bottom to the top of the floating bar, plus breathing room for scroll content. */
export function useTabBarClearance(): number {
  const { bottom } = useSafeAreaInsets();
  return barBottom(bottom) + BAR_HEIGHT + 16;
}

function barBottom(safeBottom: number): number {
  // Float just above the home indicator rather than sitting on the screen edge.
  return Math.max(safeBottom - 8, MIN_BOTTOM_GAP);
}

/**
 * Floating capsule tab bar. iOS 26 renders real Liquid Glass; older iOS, Android and web
 * use the system blur material with a translucent tint so content stays legible underneath.
 */
export function FloatingTabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const colors = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [itemWidth, setItemWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const routes = state.routes.filter((route) => route.name in tabs);
  const activeIndex = Math.max(0, routes.findIndex((route) => route.key === state.routes[state.index]?.key));

  useEffect(() => {
    if (!itemWidth) return;
    Animated.timing(offset, {
      toValue: activeIndex * itemWidth,
      duration: reduceMotion ? 0 : INDICATOR_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [activeIndex, itemWidth, offset, reduceMotion]);

  const onLayout = (event: LayoutChangeEvent) => {
    setItemWidth((event.nativeEvent.layout.width - BAR_PADDING * 2) / Math.max(routes.length, 1));
  };

  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: barBottom(insets.bottom) }]}>
      <BarSurface onLayout={onLayout}>
        {itemWidth > 0 && (
          <Animated.View pointerEvents="none" style={[styles.indicator, {
            width: itemWidth, backgroundColor: colors.accentWash, transform: [{ translateX: offset }],
          }]} />
        )}
        <View accessibilityRole="tablist" style={styles.row}>
          {routes.map((route, index) => {
            const tab = tabs[route.name];
            const selected = index === activeIndex;
            const label = t(tab.label);
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (selected || event.defaultPrevented) return;
              if (Platform.OS === 'ios') void Haptics.selectionAsync().catch(() => {});
              navigateToTab(route.key);
            };
            return (
              <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }}
                onPress={onPress} onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                style={({ pressed }) => [styles.item, { opacity: pressed && !selected ? 0.6 : 1 }]}>
                <Icon name={selected ? tab.selectedIcon : tab.icon} color={selected ? colors.accent : colors.text} size={24} />
                <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
                  style={[styles.label, { color: selected ? colors.accent : colors.text, opacity: selected ? 1 : 0.78 }]}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </BarSurface>
    </View>
  );
}

function BarSurface({ children, onLayout }: PropsWithChildren<{ onLayout: (event: LayoutChangeEvent) => void }>) {
  const colors = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  if (isLiquidGlassAvailable()) {
    return <GlassView glassEffectStyle="regular" isInteractive onLayout={onLayout} style={styles.bar}>{children}</GlassView>;
  }
  return (
    <View onLayout={onLayout} style={[styles.bar, styles.fallbackBar, { borderColor: colors.border, shadowColor: '#120D24' }]}>
      <BlurView intensity={60} tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        experimentalBlurMethod="dimezisBlurView" style={[StyleSheet.absoluteFill, styles.clip]} />
      {/* Keeps text legible where blur is weak or unavailable (Android without blur, older browsers). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: colors.surface, opacity: scheme === 'dark' ? 0.72 : 0.78 }]} />
      {children}
    </View>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: SIDE_MARGIN, right: SIDE_MARGIN, alignItems: 'center' },
  bar: { width: '100%', maxWidth: BAR_MAX_WIDTH, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, padding: BAR_PADDING },
  fallbackBar: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 10,
  },
  clip: { borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row' },
  indicator: { position: 'absolute', top: BAR_PADDING, bottom: BAR_PADDING, left: BAR_PADDING, borderRadius: (BAR_HEIGHT - BAR_PADDING * 2) / 2 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 44, paddingHorizontal: 4 },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
});
