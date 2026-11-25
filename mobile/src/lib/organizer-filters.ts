export type PayoutProvider = 'sandbox_bank' | 'sandbox_wallet';

export function normalizePayoutProvider(provider?: string | null): PayoutProvider {
  return provider === 'sandbox_bank' || provider === 'sandbox_wallet' ? provider : 'sandbox_bank';
}

export function mergeHistoryActions(
  current: readonly string[],
  incoming: readonly { action: string }[],
): string[] {
  return [...new Set([...current, ...incoming.map((item) => item.action)])];
}

export function cycleHistoryAction(current: string, availableActions: readonly string[]): string {
  const values = ['', ...availableActions];
  return values[(values.indexOf(current) + 1) % values.length];
}
