// Local-calendar helpers. A "date" is a local yyyy-mm-dd string.

export const DAY_MS = 86_400_000;

export function localDate(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** local midnight at the start of the given date */
export function startOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function startOfDay(ms: number): number {
  return startOfDate(localDate(ms));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n).getTime());
}

/** whole calendar days from a to b (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((startOfDate(b) - startOfDate(a)) / DAY_MS);
}

/** Course day (1-based) for a date, given the start date. */
export function courseDay(startDate: string, date: string): number {
  return daysBetween(startDate, date) + 1;
}
