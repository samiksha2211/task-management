// Calendar-date helpers for meeting scheduling.
//
// Every scheduling date is a plain calendar day written as "YYYY-MM-DD".
// The maths is done in UTC on those strings, so it is never shifted by the
// server's own time zone. The only place a time zone matters is deciding what
// "today" is, which uses the configured meeting time zone (IST by default).

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return toISODate(d) === value;
}

export function assertISODate(value: string, label = "date"): ISODate {
  if (!isISODate(value)) {
    const error = new Error(`${label} must be a valid date (YYYY-MM-DD)`);
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return value;
}

/** Calendar day of a Date, read in UTC (how Prisma returns @db.Date values). */
export function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function toISODateOrNull(date: Date | null | undefined): ISODate | null {
  return date ? toISODate(date) : null;
}

/** UTC midnight of a calendar day, which is what Prisma stores in a DATE column. */
export function fromISODate(value: ISODate): Date {
  const m = ISO_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function fromISODateOrNull(value: ISODate | null | undefined): Date | null {
  return value ? fromISODate(value) : null;
}

/** Calendar day of an instant in the given IANA time zone. */
export function todayISO(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(value: ISODate, days: number): ISODate {
  return toISODate(new Date(fromISODate(value).getTime() + days * DAY_MS));
}

export function diffDays(later: ISODate, earlier: ISODate): number {
  return Math.round((fromISODate(later).getTime() - fromISODate(earlier).getTime()) / DAY_MS);
}

/** 0 = Sunday ... 1 = Monday ... 6 = Saturday. */
export function dayOfWeek(value: ISODate): number {
  return fromISODate(value).getUTCDay();
}

export function isMonday(value: ISODate): boolean {
  return dayOfWeek(value) === 1;
}

export function mondayOnOrAfter(value: ISODate): ISODate {
  return addDays(value, (8 - dayOfWeek(value)) % 7);
}

export function mondayAfter(value: ISODate): ISODate {
  return mondayOnOrAfter(addDays(value, 1));
}

export function mondayOnOrBefore(value: ISODate): ISODate {
  return addDays(value, -((dayOfWeek(value) + 6) % 7));
}

/**
 * The nth Monday of a month (month is 1-12). ordinal -1 means the last Monday.
 * If the month has no nth Monday (e.g. a 5th), the last Monday is used.
 */
export function nthMondayOfMonth(year: number, month: number, ordinal = 1): ISODate {
  const first = toISODate(new Date(Date.UTC(year, month - 1, 1)));
  const firstMonday = mondayOnOrAfter(first);
  const lastDay = toISODate(new Date(Date.UTC(year, month, 0)));
  const lastMonday = mondayOnOrBefore(lastDay);
  if (ordinal === -1) return lastMonday;
  const n = Math.max(1, Math.trunc(ordinal));
  const candidate = addDays(firstMonday, (n - 1) * 7);
  return candidate > lastMonday ? lastMonday : candidate;
}

/** Year and month (1-12) of the calendar month after the given day. */
export function nextMonthOf(value: ISODate): { year: number; month: number } {
  const d = fromISODate(value);
  const month0 = d.getUTCMonth() + 1;
  return { year: d.getUTCFullYear() + Math.floor(month0 / 12), month: (month0 % 12) + 1 };
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
