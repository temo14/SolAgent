/**
 * IANA timezone helpers (no extra deps; uses Intl).
 */

export function isValidIanaTimeZone(zone: string): boolean {
  const z = zone.trim();
  if (z.length < 2 || z.length > 80) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/** Hour 0–23 in `timeZone` at `date`, or null if zone is invalid at runtime. */
export function getHourInTimeZone(timeZone: string, date: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour')?.value;
    if (h === undefined) return null;
    return parseInt(h, 10);
  } catch {
    return null;
  }
}
