import type { AdminSettings } from "../../../shared/api/admin";
import { parseHundredths } from "../../../shared/lib/parseHundredths";

// Bounds from app/services/platform.py. Amounts use tiyn and rates use basis points.
export const platformFeeLimits = { activation_fee_minor: 100_000_000, processing_fee_bps: 2_000 } as const;
export type FeeField = keyof AdminSettings;
export type FeeDraft = Partial<Record<FeeField, string>>;

export const readFeeDraft = (draft: FeeDraft, current?: AdminSettings) => {
  const changes: Partial<AdminSettings> = {};
  const invalid: FeeField[] = [];
  for (const field of Object.keys(platformFeeLimits) as FeeField[]) {
    const input = draft[field];
    if (input === undefined) continue;
    const value = parseHundredths(input);
    if (value === null || value > platformFeeLimits[field]) invalid.push(field);
    else if (value !== current?.[field]) changes[field] = value;
  }
  return { changes, invalid, dirty: invalid.length > 0 || Object.keys(changes).length > 0 };
};
