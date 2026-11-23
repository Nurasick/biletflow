// Wall-clock date/time entry in an event's IANA time zone, converted to UTC instants for the API.

/** Marks a field whose text cannot be turned into an instant (partial date, 25:00, bad zone). */
export const INVALID_DATE_TIME = 'invalid';
export const DEFAULT_EVENT_TIME_ZONE = 'Asia/Almaty';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export type WallClock = { date: string; time: string };

/** Minutes the zone is ahead of UTC at the given instant. Throws RangeError on an unknown zone. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-12-01" + "19:00" in Asia/Almaty -> "2026-12-01T14:00:00.000Z". Empty time means midnight. */
export function wallClockToIso(date: string, time: string, timeZone: string): string | null {
  const day = DATE_PATTERN.exec(date.trim());
  const clock = TIME_PATTERN.exec(time.trim() || '00:00');
  if (!day || !clock) return null;
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const wall = Date.UTC(year, month - 1, dayOfMonth, Number(clock[1]), Number(clock[2]));
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) return null;
  try {
    // Two passes settle the offset on both sides of a daylight-saving change.
    const firstGuess = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60_000;
    return new Date(wall - zoneOffsetMinutes(new Date(firstGuess), timeZone) * 60_000).toISOString();
  } catch {
    return null;
  }
}

/** The inverse of wallClockToIso, for showing a stored instant in the event's zone. */
export function isoToWallClock(value: string | null | undefined, timeZone: string): WallClock {
  if (!value || value === INVALID_DATE_TIME) return { date: '', time: '' };
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
  try {
    const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000).toISOString();
    return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
  } catch {
    const utc = instant.toISOString();
    return { date: utc.slice(0, 10), time: utc.slice(11, 16) };
  }
}

/** Field value for a pair of inputs: '' when both are empty, an ISO instant, or INVALID_DATE_TIME. */
export function wallClockValue({ date, time }: WallClock, timeZone: string): string {
  if (!date.trim() && !time.trim()) return '';
  return wallClockToIso(date, time, timeZone) ?? INVALID_DATE_TIME;
}

/** For optional API fields: null when empty, otherwise a validated ISO instant. */
export function optionalIso(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('Check the date and time fields.');
  return instant.toISOString();
}

/** For required API fields: a validated ISO instant, or a readable error. */
export function requiredIso(value: string | null | undefined): string {
  const iso = optionalIso(value);
  if (!iso) throw new Error('Check the date and time fields.');
  return iso;
}

/** A default event start: `days` from now at `hour`:00 wall-clock time in the zone. */
export function defaultEventInstant(days: number, hour: number, timeZone = DEFAULT_EVENT_TIME_ZONE): string {
  const target = isoToWallClock(new Date(Date.now() + days * 86_400_000).toISOString(), timeZone);
  return wallClockToIso(target.date, `${String(hour).padStart(2, '0')}:00`, timeZone) ?? new Date().toISOString();
}
