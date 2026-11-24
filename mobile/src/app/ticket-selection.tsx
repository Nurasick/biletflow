import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { get, ticketLimit } from '@/api/public';
import { AppText, Icon } from '@/components/design';
import { Action, Info, Panel, WorkspaceScreen } from '@/components/workspace';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import type { PublicTicketType } from '@/shared/api/events';

export default function TicketSelectionScreen() {
  const { slug, campaignToken, accessToken:rawAccessToken } = useLocalSearchParams<{ slug?: string; campaignToken?: string|string[]; accessToken?:string|string[] }>();
  const token = Array.isArray(campaignToken) ? campaignToken[0] : campaignToken;
  const accessToken=Array.isArray(rawAccessToken)?rawAccessToken[0]:rawAccessToken;
  const router = useRouter();
  const colors = useTheme();
  const { t, locale, formatNumber } = useI18n();
  const price = (minor: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
  const [types, setTypes] = useState<PublicTicketType[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    setQuantities({});
    const load = async () => {
      if (!slug) throw new Error('Choose an event first.');
      return get<PublicTicketType[]>(`/events/${encodeURIComponent(slug)}/ticket-types${accessToken?`?access_token=${encodeURIComponent(accessToken)}`:''}`);
    };
    load()
      .then((data) => { if (active) setTypes(data); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Could not load ticket types.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, retry, accessToken]));

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = types.reduce((sum, type) => sum + type.price_minor * (quantities[type.id] ?? 0), 0);
  const changeQuantity = (type: PublicTicketType, delta: number) => setQuantities((current) => {
    const count = current[type.id] ?? 0;
    const nextCount = Math.max(0, Math.min(count + delta, ticketLimit(type)));
    const currentTotal = Object.values(current).reduce((sum, quantity) => sum + quantity, 0);
    if (currentTotal - count + nextCount > 20) return current;
    const next = { ...current };
    if (nextCount > 0) next[type.id] = nextCount;
    else delete next[type.id];
    return next;
  });

  return (
    <WorkspaceScreen title={t('Choose tickets')}>
      {loading ? <Info tone="muted">{t('Loading availability...')}</Info> : error ? <>
        <Info tone="error">{t(error)}</Info>
        <Action secondary label={t('Retry')} onPress={() => setRetry((value) => value + 1)} />
      </> : <>
        {!types.length && <Panel><Info tone="muted">{t('No ticket types available.')}</Info></Panel>}
        {types.map((type) => {
          const selected = quantities[type.id] ?? 0;
          return (
            <Panel key={type.id}>
              <View style={styles.row}>
                <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 130, gap: 3 }}>
                  <AppText style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{type.name}</AppText>
                  {!!type.description && <AppText style={{ color: colors.muted, fontSize: 13 }}>{type.description}</AppText>}
                  <AppText style={{ color: colors.accent, fontSize: 14, fontWeight: '700' }}>{type.price_minor ? price(type.price_minor, type.currency) : t('Free')}</AppText>
                  <AppText style={{ color: ticketLimit(type) ? colors.muted : colors.warning, fontSize: 12 }}>
                    {ticketLimit(type) ? t('{count} available', { count: formatNumber(type.available) }) : t('Sold out')}
                  </AppText>
                </View>
                <View style={styles.stepper}>
                  <QuantityButton icon="minus" label={t('Remove one {ticket} ticket', { ticket: type.name })} disabled={!selected} onPress={() => changeQuantity(type, -1)} />
                  <AppText accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 23, textAlign: 'center' }}>{formatNumber(selected)}</AppText>
                  <QuantityButton icon="plus" label={t('Add one {ticket} ticket', { ticket: type.name })} disabled={total >= 20 || selected >= ticketLimit(type)} onPress={() => changeQuantity(type, 1)} />
                </View>
              </View>
            </Panel>
          );
        })}
        {types.length > 0 && (
          <Panel>
            <View style={styles.row}>
              <Info>{t('Total')}</Info>
              <AppText style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{price(subtotal, types[0].currency)}</AppText>
            </View>
            <Action icon="arrowRight" label={t('Continue ({count})', { count: formatNumber(total) })} disabled={!total}
              onPress={() => router.push({ pathname: '/checkout', params: { slug, selection: JSON.stringify(quantities), ...(token ? { campaignToken: token } : {}), ...(accessToken?{accessToken}:{}) } })} />
          </Panel>
        )}
      </>}
    </WorkspaceScreen>
  );
}

function QuantityButton({ icon, label, disabled, onPress }: { icon: 'plus' | 'minus'; label: string; disabled: boolean; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.step, { borderColor: colors.border, backgroundColor: pressed ? colors.accentWash : colors.raised, opacity: disabled ? 0.48 : 1 }]}>
      <Icon name={icon} color={colors.accent} size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 9 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 44, height: 44, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
