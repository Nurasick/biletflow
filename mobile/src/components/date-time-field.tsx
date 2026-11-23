import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/design';
import { FormInput } from '@/components/workspace';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/i18n';
import { INVALID_DATE_TIME, isoToWallClock, wallClockValue, type WallClock } from '@/lib/zoned-time';

type DateTimeFieldProps = {
  label: string;
  /** '' (empty), an ISO instant, or INVALID_DATE_TIME while the text cannot be parsed. */
  value: string;
  onChange: (value: string) => void;
  /** IANA zone the organizer types wall-clock time in, e.g. Asia/Almaty. */
  timeZone: string;
  optional?: boolean;
  editable?: boolean;
};

/** Separate date and time inputs in the event's zone instead of a raw ISO 8601 string. */
export function DateTimeField({ label, value, onChange, timeZone, optional = false, editable = true }: DateTimeFieldProps) {
  const colors = useTheme();
  const { t } = useI18n();
  const [text, setText] = useState<WallClock>(() => isoToWallClock(value, timeZone));
  const lastEmitted = useRef(value);
  const lastZone = useRef(timeZone);
  const textRef = useRef(text);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const zoneChanged = lastZone.current !== timeZone;
    lastZone.current = timeZone;
    // A reload or reset from the parent wins, even when it arrives together with a new zone.
    if (value !== lastEmitted.current && value !== INVALID_DATE_TIME) {
      lastEmitted.current = value;
      const shown = isoToWallClock(value, timeZone);
      textRef.current = shown;
      setText(shown);
      return;
    }
    // Otherwise a zone edit keeps the typed wall-clock time and moves the instant.
    if (zoneChanged) {
      const next = wallClockValue(textRef.current, timeZone);
      lastEmitted.current = next;
      onChangeRef.current(next);
    }
  }, [value, timeZone]);

  const update = (next: WallClock) => {
    textRef.current = next;
    setText(next);
    const emitted = wallClockValue(next, timeZone);
    lastEmitted.current = emitted;
    onChange(emitted);
  };
  const invalid = wallClockValue(text, timeZone) === INVALID_DATE_TIME;

  return (
    <View style={{ gap: 7 }}>
      <AppText style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
        {optional ? `${label} (${t('optional')})` : label}
      </AppText>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <FormInput style={{ flex: 3, flexBasis: 0, minWidth: 0 }} value={text.date} editable={editable} placeholder="2026-12-01"
          accessibilityLabel={t('{field} date', { field: label })} autoCapitalize="none" autoCorrect={false}
          keyboardType="numbers-and-punctuation" maxLength={10} onChangeText={(date) => update({ ...text, date })} />
        <FormInput style={{ flex: 2, flexBasis: 0, minWidth: 0 }} value={text.time} editable={editable} placeholder="19:00"
          accessibilityLabel={t('{field} time', { field: label })} autoCapitalize="none" autoCorrect={false}
          keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(time) => update({ ...text, time })} />
      </View>
      <AppText style={{ color: invalid ? colors.danger : colors.muted, fontSize: 12 }}>
        {invalid ? t('Use YYYY-MM-DD for the date and HH:MM (24-hour) for the time.') : t('Date and 24-hour time in {zone}', { zone: timeZone })}
      </AppText>
    </View>
  );
}
