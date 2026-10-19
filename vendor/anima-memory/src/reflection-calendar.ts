import {
  epochNanosecondsToZonedParts,
  floorEpochNanosecondsToMilliseconds,
  localDateTimeToEpochNanoseconds,
  localDateTimeToUtcEpochNanoseconds,
} from "./reflection-calendar-internal.ts";
import type { ZonedDateTimeParts } from "./reflection-calendar-internal.ts";

export const AUTOMATIC_REFLECTION_TIMEZONE = "Asia/Shanghai" as const;
export const AUTOMATIC_REFLECTION_KINDS = ["daily", "weekly", "monthly"] as const;
export const AUTOMATIC_REFLECTION_MIN_YEAR = 2;
export const AUTOMATIC_REFLECTION_MAX_YEAR = 9998;
export const AUTOMATIC_REFLECTION_COMPLETE_PERIOD = "complete" as const;

export type AutomaticReflectionKind = (typeof AUTOMATIC_REFLECTION_KINDS)[number];
export type InstantInput = string | number;
export type AutomaticReflectionCursorPeriod = string | typeof AUTOMATIC_REFLECTION_COMPLETE_PERIOD;

export type AutomaticReflectionSelector = Readonly<{
  kind: AutomaticReflectionKind;
  project_uid: string;
  timezone: typeof AUTOMATIC_REFLECTION_TIMEZONE;
  period_key: string;
  start_at: string;
  end_at: string;
}>;

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const STRICT_INSTANT_MIN_YEAR = 1;
const STRICT_INSTANT_MAX_YEAR = 9999;
const DAY_MILLISECONDS = 86_400_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_MINUTE = 60_000_000_000n;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function assertYearInRange(year: number, minimum: number, maximum: number, message: string): void {
  if (!Number.isInteger(year) || year < minimum || year > maximum) invalid(message);
}

function assertAutomaticYear(year: number): void {
  assertYearInRange(
    year,
    AUTOMATIC_REFLECTION_MIN_YEAR,
    AUTOMATIC_REFLECTION_MAX_YEAR,
    "automatic calendar year must be between 0002 and 9998",
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function assertCalendarDate(year: number, month: number, day: number): void {
  assertYearInRange(year, STRICT_INSTANT_MIN_YEAR, STRICT_INSTANT_MAX_YEAR, "invalid calendar date");
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) invalid("invalid calendar date");
}

function assertAutomaticCalendarDate(date: CalendarDate): void {
  assertCalendarDate(date.year, date.month, date.day);
  assertAutomaticYear(date.year);
}

function calendarDateToUtcMillis(date: CalendarDate, hour = 0, minute = 0, second = 0, millisecond = 0): number {
  const value = new Date(0);
  value.setUTCFullYear(date.year, date.month - 1, date.day);
  value.setUTCHours(hour, minute, second, millisecond);
  return value.getTime();
}

function utcMillisToCalendarDate(epochMilliseconds: number): CalendarDate {
  const value = new Date(epochMilliseconds);
  if (!Number.isFinite(value.getTime())) invalid("instant is outside the supported date range");
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function addDays(date: CalendarDate, count: number): CalendarDate {
  return utcMillisToCalendarDate(calendarDateToUtcMillis(date) + count * DAY_MILLISECONDS);
}

function nextMonth(date: CalendarDate): CalendarDate {
  return date.month === 12
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: date.month + 1, day: 1 };
}

function dateKey(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function monthKey(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`;
}

function compareDates(left: CalendarDate, right: CalendarDate): number {
  if (left.year !== right.year) return left.year < right.year ? -1 : 1;
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  return 0;
}

function assertKind(value: unknown): asserts value is AutomaticReflectionKind {
  if (!AUTOMATIC_REFLECTION_KINDS.includes(value as AutomaticReflectionKind)) invalid("kind must be daily, weekly, or monthly");
}

function assertProjectUid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) invalid("project_uid must be a canonical lowercase UUID");
}

function assertMonday(date: CalendarDate): void {
  if (new Date(calendarDateToUtcMillis(date)).getUTCDay() !== 1) invalid("weekly period_key must be a Monday");
}

function parseDateKey(value: unknown, kind: "daily" | "weekly"): CalendarDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${kind} period_key must use YYYY-MM-DD`);
  const [yearText, monthText, dayText] = value.split("-");
  const date = { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
  assertAutomaticCalendarDate(date);
  if (kind === "weekly") assertMonday(date);
  return date;
}

function parseMonthKey(value: unknown): CalendarDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) invalid("monthly period_key must use YYYY-MM");
  const [yearText, monthText] = value.split("-");
  const date = { year: Number(yearText), month: Number(monthText), day: 1 };
  assertAutomaticCalendarDate(date);
  return date;
}

function parsePeriodDate(kind: AutomaticReflectionKind, periodKey: unknown): CalendarDate {
  return kind === "monthly" ? parseMonthKey(periodKey) : parseDateKey(periodKey, kind);
}

function assertUtcYear(epochNanoseconds: bigint, message: string): void {
  const epochMilliseconds = floorEpochNanosecondsToMilliseconds(epochNanoseconds);
  const year = new Date(epochMilliseconds).getUTCFullYear();
  assertYearInRange(year, STRICT_INSTANT_MIN_YEAR, STRICT_INSTANT_MAX_YEAR, message);
}

function parseOffsetMinutes(offsetText: string): number {
  if (offsetText === "Z") return 0;
  const hours = Number(offsetText.slice(1, 3));
  const minutes = Number(offsetText.slice(4, 6));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) invalid("invalid UTC offset");
  const total = hours * 60 + minutes;
  return offsetText[0] === "+" ? total : -total;
}

function parseExactInstant(value: string): bigint {
  if (typeof value !== "string") invalid("instant must be an offset-bearing ISO instant");
  const match = INSTANT_PATTERN.exec(value);
  if (match === null) invalid("instant must be an offset-bearing ISO instant");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  assertCalendarDate(year, month, day);
  if (hour > 23 || minute > 59 || second > 59) invalid("invalid clock time");

  const fraction = match[7] ?? "";
  const nanosecond = fraction.length === 0 ? 0 : Number(fraction.padEnd(9, "0"));
  const localNanoseconds = localDateTimeToUtcEpochNanoseconds({
    year,
    month,
    day,
    hour,
    minute,
    second,
    nanosecond,
  });
  const utcNanoseconds = localNanoseconds - BigInt(parseOffsetMinutes(match[8]!)) * NANOSECONDS_PER_MINUTE;
  assertUtcYear(utcNanoseconds, "instant is outside the supported four-digit year range");
  return utcNanoseconds;
}

function validateEpochMilliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || !Number.isFinite(value)) {
    invalid("instant must be an epoch millisecond integer or an offset-bearing ISO instant");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid("instant is outside the supported date range");
  assertYearInRange(
    date.getUTCFullYear(),
    STRICT_INSTANT_MIN_YEAR,
    STRICT_INSTANT_MAX_YEAR,
    "instant is outside the supported four-digit year range",
  );
  return value;
}

function parseInstantInputExact(value: InstantInput): bigint {
  if (typeof value === "string") return parseExactInstant(value);
  return BigInt(validateEpochMilliseconds(value)) * NANOSECONDS_PER_MILLISECOND;
}

function selectorBounds(kind: AutomaticReflectionKind, periodKey: string): { start: bigint; end: bigint } {
  const startDate = parsePeriodDate(kind, periodKey);
  const endDate = kind === "monthly" ? nextMonth(startDate) : addDays(startDate, kind === "weekly" ? 7 : 1);
  return {
    start: localDateTimeToEpochNanoseconds({ ...startDate, hour: 0, minute: 0, second: 0 }),
    end: localDateTimeToEpochNanoseconds({ ...endDate, hour: 0, minute: 0, second: 0 }),
  };
}

/** Parse a strict offset-bearing ISO instant and return floored epoch milliseconds. */
export function parseInstant(value: string): number {
  return floorEpochNanosecondsToMilliseconds(parseExactInstant(value));
}

/** Format epoch milliseconds as the exact UTC spelling YYYY-MM-DDTHH:mm:ss.sssZ. */
export function formatUtcInstant(epochMilliseconds: number): string {
  const value = validateEpochMilliseconds(epochMilliseconds);
  const iso = new Date(value).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) {
    invalid("instant is outside the supported four-digit year range");
  }
  return iso;
}

/** Compare exact epoch nanoseconds, without reducing string inputs to milliseconds. */
export function compareInstants(left: InstantInput, right: InstantInput): -1 | 0 | 1 {
  const leftNanoseconds = parseInstantInputExact(left);
  const rightNanoseconds = parseInstantInputExact(right);
  if (leftNanoseconds < rightNanoseconds) return -1;
  if (leftNanoseconds > rightNanoseconds) return 1;
  return 0;
}

/** Construct the canonical six-field automatic reflection selector. */
export function automaticReflectionSelector(
  project_uid: string,
  kind: AutomaticReflectionKind,
  period_key: string,
): AutomaticReflectionSelector {
  assertProjectUid(project_uid);
  assertKind(kind);
  const bounds = selectorBounds(kind, period_key);
  return Object.freeze({
    kind,
    project_uid,
    timezone: AUTOMATIC_REFLECTION_TIMEZONE,
    period_key,
    start_at: formatUtcInstant(floorEpochNanosecondsToMilliseconds(bounds.start)),
    end_at: formatUtcInstant(floorEpochNanosecondsToMilliseconds(bounds.end)),
  });
}

/** Return the daily, weekly, or monthly local period containing an instant. */
export function periodKeyContaining(kind: AutomaticReflectionKind, instant: InstantInput): string {
  assertKind(kind);
  const localDateTime = epochNanosecondsToZonedParts(parseInstantInputExact(instant));
  const localDate = { year: localDateTime.year, month: localDateTime.month, day: localDateTime.day };
  assertAutomaticYear(localDate.year);
  if (kind === "monthly") return monthKey(localDate);
  if (kind === "daily") return dateKey(localDate);

  const weekday = new Date(calendarDateToUtcMillis(localDate)).getUTCDay();
  const weeklyDate = addDays(localDate, weekday === 0 ? -6 : 1 - weekday);
  assertAutomaticYear(weeklyDate.year);
  return dateKey(weeklyDate);
}

/** Return the next period key after a valid daily, weekly, or monthly key. */
export function nextPeriodKey(kind: AutomaticReflectionKind, period_key: string): string {
  assertKind(kind);
  const date = parsePeriodDate(kind, period_key);
  const nextDate = kind === "monthly" ? nextMonth(date) : addDays(date, kind === "weekly" ? 7 : 1);
  assertAutomaticYear(nextDate.year);
  return kind === "monthly" ? monthKey(nextDate) : dateKey(nextDate);
}

/** Return the next cursor period, including the finite terminal marker. */
export function nextAutomaticCursorPeriod(
  kind: AutomaticReflectionKind,
  period_key: AutomaticReflectionCursorPeriod,
): AutomaticReflectionCursorPeriod {
  assertKind(kind);
  if (period_key === AUTOMATIC_REFLECTION_COMPLETE_PERIOD) invalid("complete is not a valid cursor input");
  const date = parsePeriodDate(kind, period_key);
  const isFinal =
    (kind === "daily" && dateKey(date) === "9998-12-31") ||
    (kind === "weekly" && dateKey(date) === "9998-12-28") ||
    (kind === "monthly" && monthKey(date) === "9998-12");
  if (isFinal) return AUTOMATIC_REFLECTION_COMPLETE_PERIOD;
  return nextPeriodKey(kind, period_key);
}

/** Return the fixed Shanghai-local due timestamp for a selector. */
export function selectorDueAt(selector: AutomaticReflectionSelector): string {
  assertProjectUid(selector.project_uid);
  assertKind(selector.kind);
  if (selector.timezone !== AUTOMATIC_REFLECTION_TIMEZONE) invalid("selector timezone must be Asia/Shanghai");
  const date = parsePeriodDate(selector.kind, selector.period_key);
  const dueDate = selector.kind === "monthly" ? nextMonth(date) : addDays(date, selector.kind === "weekly" ? 7 : 1);
  const dueMinutes = selector.kind === "daily" ? 5 : selector.kind === "weekly" ? 15 : 30;
  const dueNanoseconds = localDateTimeToEpochNanoseconds({
    ...dueDate,
    hour: 0,
    minute: dueMinutes,
    second: 0,
  });
  return formatUtcInstant(floorEpochNanosecondsToMilliseconds(dueNanoseconds));
}

/** Test membership in a selector's half-open UTC interval [start_at, end_at). */
export function selectorContains(selector: AutomaticReflectionSelector, instant: InstantInput): boolean {
  assertProjectUid(selector.project_uid);
  assertKind(selector.kind);
  if (selector.timezone !== AUTOMATIC_REFLECTION_TIMEZONE) invalid("selector timezone must be Asia/Shanghai");
  parsePeriodDate(selector.kind, selector.period_key);
  const value = parseInstantInputExact(instant);
  const start = parseExactInstant(selector.start_at);
  const end = parseExactInstant(selector.end_at);
  return value >= start && value < end;
}

function firstWeeklyDueDate(): CalendarDate {
  let key: CalendarDate = { year: AUTOMATIC_REFLECTION_MIN_YEAR, month: 1, day: 1 };
  while (new Date(calendarDateToUtcMillis(key)).getUTCDay() !== 1) key = addDays(key, 1);
  return addDays(key, 7);
}

/** Return the earliest supported fixed boundary strictly after an instant. */
export function nextAutomaticBoundary(instant: InstantInput): string {
  const value = parseInstantInputExact(instant);
  const local = epochNanosecondsToZonedParts(value);
  if (local.year < AUTOMATIC_REFLECTION_MIN_YEAR || local.year > 9999) {
    invalid("instant is outside the supported automatic calendar horizon");
  }
  const localDate = { year: local.year, month: local.month, day: local.day };
  if (local.year === 9999 && compareDates(localDate, { year: 9999, month: 1, day: 4 }) > 0) {
    invalid("instant is outside the supported automatic calendar horizon");
  }

  const candidates = new Set<bigint>();
  const resolveDue = (date: CalendarDate, minute: number): bigint =>
    localDateTimeToEpochNanoseconds({ ...date, hour: 0, minute, second: 0 });
  const addCycleCandidates = (
    dates: readonly CalendarDate[],
    minute: number,
    lowerDate: CalendarDate,
    upperDate: CalendarDate,
  ): void => {
    const lower = resolveDue(lowerDate, minute);
    const upper = resolveDue(upperDate, minute);
    for (const date of dates) {
      if (date.year < STRICT_INSTANT_MIN_YEAR || date.year > STRICT_INSTANT_MAX_YEAR) continue;
      const candidate = resolveDue(date, minute);
      if (candidate > value && candidate >= lower && candidate <= upper) candidates.add(candidate);
    }
  };

  const dailyNextDate = addDays(localDate, 1);
  addCycleCandidates(
    [localDate, dailyNextDate],
    5,
    { year: 2, month: 1, day: 2 },
    { year: 9999, month: 1, day: 1 },
  );

  const weekday = new Date(calendarDateToUtcMillis(localDate)).getUTCDay();
  const currentMonday = addDays(localDate, weekday === 0 ? -6 : 1 - weekday);
  addCycleCandidates(
    [currentMonday, addDays(currentMonday, 7)],
    15,
    firstWeeklyDueDate(),
    { year: 9999, month: 1, day: 4 },
  );

  const monthStart = { year: localDate.year, month: localDate.month, day: 1 };
  addCycleCandidates(
    [monthStart, nextMonth(monthStart)],
    30,
    { year: 2, month: 2, day: 1 },
    { year: 9999, month: 1, day: 1 },
  );

  if (candidates.size === 0) invalid("no supported automatic boundary remains");
  const earliest = [...candidates].reduce((minimum, candidate) => (candidate < minimum ? candidate : minimum));
  return formatUtcInstant(floorEpochNanosecondsToMilliseconds(earliest));
}
