const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const isEventTimeZone = (value: string) => {
  if (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

export const eventTimeZones = [...new Set([
  "UTC", "Asia/Almaty", "Asia/Qyzylorda", ...Intl.supportedValuesOf("timeZone"),
])].sort();

export const parseLocalDateTime = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp : null;
};

// Resolve wall-clock input in the event's zone, independently of the browser's zone.
// Sampling both sides of the date also finds both offsets at a DST transition.
export const resolveEventDateTime = (value: string, timeZone: string): number[] => {
  const local = parseLocalDateTime(value);
  if (local === null || !isEventTimeZone(timeZone)) return [];
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const wallTime = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
    return Date.parse(`${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  };
  const offsets = new Set([-DAY, 0, DAY].map((delta) => wallTime(local + delta) - (local + delta)));
  return [...offsets].map((offset) => local - offset)
    .filter((instant) => wallTime(instant) === local).sort((a, b) => a - b);
};

// The inverse of resolveEventDateTime: an instant from the API shown as the
// wall-clock "YYYY-MM-DDTHH:mm" it was in the event's own zone, which is what
// the form edits. Independent of the browser's zone.
export const toLocalDateTime = (iso: string, timeZone: string): string => {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
